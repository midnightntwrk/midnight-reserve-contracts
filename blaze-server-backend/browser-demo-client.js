/**
 * Minimal browser client for demo server
 * Just makes API calls to the server that does all the work
 */

class DemoClient {
  constructor(serverUrl = 'http://localhost:3042') {
    this.serverUrl = serverUrl;
    this.sessionId = null;
  }

  async loadDemo(demoName) {
    try {
      // Load demo content from file
      const response = await fetch(`/demo-flows/${demoName}`);
      if (!response.ok) {
        throw new Error(`Failed to load demo: ${response.statusText}`);
      }
      const demoContent = await response.text();
      return JSON.parse(demoContent);
    } catch (error) {
      console.error('Error loading demo:', error);
      throw error;
    }
  }

  async loadDemoFromContent(content, fileName) {
    try {
      // Parse the content as JSON
      const demo = JSON.parse(content);
      
      // Initialize session with the parsed demo
      await this.initializeSessionWithDemo(demo);
      
      return demo;
    } catch (error) {
      console.error('Error loading demo from content:', error);
      throw error;
    }
  }

  async initializeSessionWithDemo(demo) {
    try {
      const response = await fetch(`${this.serverUrl}/demo/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          demo,
          baseUrl: 'http://localhost:3041'
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const result = await response.json();
      this.sessionId = result.sessionId;
      console.log('Created new session:', this.sessionId);
    } catch (error) {
      console.error('Error initializing session:', error);
      throw error;
    }
  }

  async analyzeOperationType(block) {
    // For now, return a default type - this can be enhanced later
    return 'transaction';
  }

  async executeStanza(stanzaIndex) {
    try {
      // Initialize session if needed
      if (!this.sessionId) {
        await this.initializeSession();
      }

      const response = await fetch(`${this.serverUrl}/demo/execute-stanza`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          stanzaIndex
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to execute stanza: ${response.statusText}`);
      }

      const result = await response.json();
      return result.results;
    } catch (error) {
      console.error('Error executing stanza:', error);
      
      // If session error, clear session and retry once
      if (error.message.includes('session') || error.message.includes('Session')) {
        this.sessionId = null;
        throw new Error('Session expired. Please try again.');
      }
      
      throw error;
    }
  }

  async initializeSession() {
    try {
      // Load the demo first
      const demo = await this.loadDemo('simple-wallet-test.demonb');
      await this.initializeSessionWithDemo(demo);
    } catch (error) {
      console.error('Error initializing session:', error);
      throw error;
    }
  }

  async reset() {
    this.sessionId = null;
  }
}

// Convenience function
async function executeDemo(demo, baseUrl = 'http://localhost:3041', serverUrl = 'http://localhost:3042') {
  const client = new DemoClient(serverUrl);
  
  try {
    await client.initDemo(demo, baseUrl);
    const result = await client.executeAll();
    return result;
  } finally {
    await client.cleanup();
  }
}

// Export for browser use
if (typeof window !== 'undefined') {
  window.DemoClient = DemoClient;
  window.executeDemo = executeDemo;
}
