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
      console.log(`[DemoClient] Loading demo: ${demoName}`);
      // Load demo content from file
      const response = await fetch(`/demo-flows/${demoName}`);
      if (!response.ok) {
        throw new Error(`Failed to load demo: ${response.statusText}`);
      }
      const demoContent = await response.text();
      console.log(`[DemoClient] Successfully loaded demo: ${demoName}`);
      const demo = JSON.parse(demoContent);
      
      // Initialize session with the loaded demo
      await this.initializeSessionWithDemo(demo);
      
      return demo;
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
      
      // Clear any existing watchers when starting a new session
      this.clearWatchers();
    } catch (error) {
      console.error('Error initializing session:', error);
      throw error;
    }
  }

  clearWatchers() {
    // Clear watchers from the frontend
    if (window.demoUI) {
      window.demoUI.watchersInfo = [];
      window.demoUI.updateWatcherPanel();
    }
  }

  async analyzeOperationType(block) {
    // For now, return a default type - this can be enhanced later
    return 'transaction';
  }

  async executeWatchers() {
    try {
      if (!this.sessionId) {
        throw new Error('No active session. Please load a demo first.');
      }

      const response = await fetch(`${this.serverUrl}/demo/execute-watchers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to execute watchers: ${response.statusText}`);
      }

      const result = await response.json();
      return {
        watchResults: result.watchResults,
        watchersInfo: result.watchersInfo
      };
    } catch (error) {
      console.error('Error executing watchers:', error);
      throw error;
    }
  }

  async executeStanza(stanzaIndex) {
    try {
      // Check if session exists
      if (!this.sessionId) {
        throw new Error('No active session. Please load a demo first.');
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
      
      // Execute watchers after successful stanza execution
      let watchResults = {};
      let watchersInfo = [];
      try {
        const watcherResponse = await this.executeWatchers();
        watchResults = watcherResponse.watchResults || {};
        watchersInfo = watcherResponse.watchersInfo || [];
      } catch (watchError) {
        console.error('Watcher execution failed:', watchError);
      }
      
      return {
        results: result.results,
        watchResults,
        watchersInfo
      };
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
      // This method should not be called directly anymore
      // Sessions should be initialized with specific demo content via initializeSessionWithDemo()
      throw new Error('Session must be initialized with specific demo content. Use initializeSessionWithDemo() instead.');
    } catch (error) {
      console.error('Error initializing session:', error);
      throw error;
    }
  }

  async reset() {
    this.sessionId = null;
  }

  async updateDemo(demo) {
    try {
      if (!this.sessionId) {
        throw new Error('No active session. Please load a demo first.');
      }

      const response = await fetch(`${this.serverUrl}/demo/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          demo
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to update demo: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[DemoClient] Demo updated successfully');
      return result;
    } catch (error) {
      console.error('Error updating demo:', error);
      throw error;
    }
  }

  async saveDemo(filename) {
    try {
      if (!this.sessionId) {
        throw new Error('No active session. Please load a demo first.');
      }

      const response = await fetch(`${this.serverUrl}/demo/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          filename
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save demo: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`[DemoClient] Demo saved successfully to ${filename}`);
      return result;
    } catch (error) {
      console.error('Error saving demo:', error);
      throw error;
    }
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
