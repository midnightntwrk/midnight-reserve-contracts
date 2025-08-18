#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const http = require('http');
const { promisify } = require('util');

// Import fetch for Node.js (available in Node 18+)
const fetch = globalThis.fetch || require('node-fetch');

const execAsync = promisify(exec);

// Parse command line arguments
const args = process.argv.slice(2);
const enableLogging = args.includes('--logging') || args.includes('-l');

class DemoServerManager {
  constructor() {
    this.servers = {
      blaze: { port: 3041, process: null, name: 'Blaze Backend' },
      demo: { port: 3042, process: null, name: 'Demo Server' },
      web: { port: 8080, process: null, name: 'Web Server' }
    };
    this.isShuttingDown = false;
    this.monitoringInterval = null;
  }

  async start() {
    console.log('🚀 Starting Demo Environment...\n');
    
    try {
      // Kill competing processes first
      await this.killCompetingProcesses();
      
      // Start all servers
      await this.startAllServers();
      
      // Wait for servers to be ready
      await this.waitForServers();
      
      // Health check
      await this.healthCheck();
      
      // Keep running and monitor
      this.startMonitoring();
      
      // Handle shutdown
      this.setupShutdownHandlers();
    } catch (error) {
      console.error('❌ Failed to start demo environment:', error.message);
      await this.shutdown();
      process.exit(1);
    }
  }

  async killCompetingProcesses() {
    console.log('🔪 Checking for competing processes...');
    
    for (const [name, server] of Object.entries(this.servers)) {
      try {
        const { stdout } = await execAsync(`lsof -ti:${server.port}`);
        if (stdout.trim()) {
          const pids = stdout.trim().split('\n');
          console.log(`🔄 Killing ${pids.length} process(es) on port ${server.port}...`);
          
          for (const pid of pids) {
            try {
              await execAsync(`kill -9 ${pid}`);
            } catch (killError) {
              console.warn(`⚠️  Failed to kill process ${pid}: ${killError.message}`);
            }
          }
          
          // Wait a moment for processes to fully terminate
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        // No processes found on this port, which is fine
      }
    }
    
    console.log('✅ Port cleanup completed\n');
  }

  async startAllServers() {
    console.log('🔧 Starting servers...');
    
    // Start Blaze backend server
    this.servers.blaze.process = spawn('bun', ['run', 'dev'], {
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, PORT: this.servers.blaze.port.toString() }
    });
    
    // Start Demo server
    this.servers.demo.process = spawn('bun', ['src/demo-interpreter/server/demo-server.js'], {
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, PORT: this.servers.demo.port.toString() }
    });
    
    // Start Web server
    this.servers.web.process = spawn('bunx', ['http-server', '-p', '8080', '-c-1'], {
      stdio: 'pipe',
      shell: true
    });

    // Give servers a moment to start up
    console.log('   Waiting for servers to initialize...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Log server outputs
    this.servers.blaze.process.stdout?.on('data', (data) => {
      console.log(`[${this.servers.blaze.name}] ${data.toString().trim()}`);
    });
    
    this.servers.demo.process.stdout?.on('data', (data) => {
      console.log(`[${this.servers.demo.name}] ${data.toString().trim()}`);
    });
    
    this.servers.web.process.stdout?.on('data', (data) => {
      console.log(`[${this.servers.web.name}] ${data.toString().trim()}`);
    });

    // Handle errors
    Object.values(this.servers).forEach(server => {
      server.process.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        // Only log actual errors, not normal startup messages
        if (output.includes('ERROR') || output.includes('Error:') || output.includes('EADDRINUSE')) {
          console.error(`[${server.name} ERROR] ${output}`);
        }
      });
      
      server.process.on('error', (error) => {
        console.error(`[${server.name} PROCESS ERROR] ${error.message}`);
      });
      
      server.process.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          console.error(`[${server.name}] Process exited with code ${code}`);
          throw new Error(`${server.name} failed to start (exit code: ${code})`);
        }
      });
    });
  }

  async waitForServers() {
    console.log('⏳ Waiting for servers to be ready...');
    
    const maxAttempts = 10;
    const delay = 3000; // Increased delay to reduce spam
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`   Attempt ${attempt}/${maxAttempts}...`);
      
      const ready = await this.checkAllServersReady();
      if (ready) {
        console.log('✅ All servers are ready!\n');
        return;
      }
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('Servers failed to start within expected time');
  }

  async checkAllServersReady() {
    const checks = Object.values(this.servers).map(async server => {
      const isReady = await this.checkServerHealth(server.port, server.name);
      if (isReady) {
        console.log(`   ✅ ${server.name} is ready`);
      } else {
        console.log(`   ❌ ${server.name} not ready`);
      }
      return isReady;
    });
    
    const results = await Promise.allSettled(checks);
    const allReady = results.every(result => result.status === 'fulfilled' && result.value);
    
    if (allReady) {
      console.log('   🎉 All servers ready!');
    } else {
      console.log('   ⏳ Some servers still starting...');
    }
    
    return allReady;
  }

  async checkServerHealth(port, name) {
    return new Promise((resolve) => {
      let resolved = false;
      
      const cleanup = () => {
        if (!resolved) {
          resolved = true;
        }
      };
      
      // Web server (http-server) doesn't have a /health endpoint, so just check if it's listening
      if (port === this.servers.web.port) {
        const req = http.get(`http://localhost:${port}`, (res) => {
          if (!resolved) {
            console.log(`   [${name}] Health check successful - status ${res.statusCode}`);
            resolved = true;
            resolve(true);
          }
        });
        
        req.on('error', (error) => {
          if (!resolved) {
            console.log(`   [${name}] Health check failed: ${error.message}`);
            resolved = true;
            resolve(false);
          }
        });
        
        req.setTimeout(3000, () => {
          if (!resolved) {
            req.destroy();
            console.log(`   [${name}] Health check timeout`);
            resolved = true;
            resolve(false);
          }
        });
      } else if (port === this.servers.blaze.port) {
        // Blaze Backend uses /api/logging endpoint for health check
        const req = http.get(`http://localhost:${port}/api/logging`, (res) => {
          if (!resolved) {
            if (res.statusCode === 200) {
              console.log(`   [${name}] Health check successful - status ${res.statusCode}`);
              resolved = true;
              resolve(true);
            } else {
              console.log(`   [${name}] Health check returned status ${res.statusCode}`);
              resolved = true;
              resolve(false);
            }
          }
        });
        
        req.on('error', (error) => {
          if (!resolved) {
            console.log(`   [${name}] Health check failed: ${error.message}`);
            resolved = true;
            resolve(false);
          }
        });
        
        req.setTimeout(3000, () => {
          if (!resolved) {
            req.destroy();
            console.log(`   [${name}] Health check timeout`);
            resolved = true;
            resolve(false);
          }
        });
      } else {
        // Demo server has /health endpoint
        const req = http.get(`http://localhost:${port}/health`, (res) => {
          if (!resolved) {
            if (res.statusCode === 200) {
              console.log(`   [${name}] Health check successful - status ${res.statusCode}`);
              resolved = true;
              resolve(true);
            } else {
              console.log(`   [${name}] Health check returned status ${res.statusCode}`);
              resolved = true;
              resolve(false);
            }
          }
        });
        
        req.on('error', (error) => {
          if (!resolved) {
            console.log(`   [${name}] Health check failed: ${error.message}`);
            resolved = true;
            resolve(false);
          }
        });
        
        req.setTimeout(3000, () => {
          if (!resolved) {
            req.destroy();
            console.log(`   [${name}] Health check timeout`);
            resolved = true;
            resolve(false);
          }
        });
      }
    });
  }

  async healthCheck() {
    console.log('🏥 Performing health check...');
    
    const healthResults = await Promise.allSettled([
      this.checkServerHealth(this.servers.blaze.port, 'Blaze Backend'),
      this.checkServerHealth(this.servers.demo.port, 'Demo Server'),
      this.checkServerHealth(this.servers.web.port, 'Web Server')
    ]);
    
    const allHealthy = healthResults.every(result => 
      result.status === 'fulfilled' && result.value
    );
    
    if (allHealthy) {
      console.log('✅ All servers are healthy!');
      
      // Enable logging if requested
      if (enableLogging) {
        console.log('🔧 Enabling Blaze server logging...');
        try {
          const response = await fetch('http://localhost:3041/api/logging', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true })
          });
          
          if (response.ok) {
            const result = await response.json();
            console.log(`✅ Logging enabled: ${result.message}`);
          } else {
            console.log('⚠️  Failed to enable logging');
          }
        } catch (error) {
          console.log('⚠️  Failed to enable logging:', error.message);
        }
      }
      
      console.log('\n🌐 Demo Environment is ready:');
      console.log(`   • Blaze Backend: http://localhost:${this.servers.blaze.port}`);
      console.log(`   • Demo Server:   http://localhost:${this.servers.demo.port}`);
      console.log(`   • Web Interface: http://localhost:${this.servers.web.port}`);
      console.log(`\n📖 API Documentation: http://localhost:${this.servers.blaze.port}/api`);
      console.log('\n💡 Press Ctrl+C to stop all servers\n');
    } else {
      throw new Error('Some servers failed health check');
    }
  }

  startMonitoring() {
    // Monitor server processes every 30 seconds
    this.monitoringInterval = setInterval(() => {
      if (this.isShuttingDown) return;
      
      Object.values(this.servers).forEach(server => {
        if (server.process && server.process.exitCode !== null) {
          console.error(`❌ ${server.name} has stopped unexpectedly`);
          this.shutdown();
        }
      });
    }, 30000);
  }

  setupShutdownHandlers() {
    const shutdown = () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      console.log('\n🛑 Shutting down servers...');
      this.shutdown();
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  async shutdown() {
    console.log('🔄 Stopping all servers...');
    
    // Clear monitoring interval
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    const shutdownPromises = Object.values(this.servers).map(server => {
      if (server.process && !server.process.killed) {
        return new Promise((resolve) => {
          server.process.on('close', () => resolve());
          server.process.kill('SIGTERM');
          
          // Force kill after 5 seconds
          setTimeout(() => {
            if (!server.process.killed) {
              server.process.kill('SIGKILL');
            }
            resolve();
          }, 5000);
        });
      }
      return Promise.resolve();
    });
    
    await Promise.all(shutdownPromises);
    console.log('✅ All servers stopped');
    process.exit(0);
  }
}

// Start the demo environment
const manager = new DemoServerManager();
manager.start().catch(error => {
  console.error('❌ Failed to start demo environment:', error.message);
  process.exit(1);
});
