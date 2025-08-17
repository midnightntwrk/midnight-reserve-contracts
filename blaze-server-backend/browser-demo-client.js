/**
 * Minimal browser client for demo server
 * Just makes API calls to the server that does all the work
 */

class DemoClient {
  constructor(serverUrl = 'http://localhost:3032') {
    this.serverUrl = serverUrl;
    this.sessionId = null;
  }

  async initDemo(demo, baseUrl = 'http://localhost:3031') {
    const response = await fetch(`${this.serverUrl}/demo/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo, baseUrl })
    });

    if (!response.ok) {
      throw new Error(`Failed to initialize demo: ${response.status}`);
    }

    const data = await response.json();
    this.sessionId = data.sessionId;
    return data;
  }

  async executeStanza(stanzaIndex) {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const response = await fetch(`${this.serverUrl}/demo/execute-stanza`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, stanzaIndex })
    });

    if (!response.ok) {
      throw new Error(`Failed to execute stanza: ${response.status}`);
    }

    return await response.json();
  }

  async executeAll() {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const response = await fetch(`${this.serverUrl}/demo/execute-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId })
    });

    if (!response.ok) {
      throw new Error(`Failed to execute all: ${response.status}`);
    }

    return await response.json();
  }

  async getSession() {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const response = await fetch(`${this.serverUrl}/demo/session/${this.sessionId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.status}`);
    }

    return await response.json();
  }

  async reset() {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const response = await fetch(`${this.serverUrl}/demo/reset/${this.sessionId}`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Failed to reset: ${response.status}`);
    }

    return await response.json();
  }

  async cleanup() {
    if (this.sessionId) {
      await fetch(`${this.serverUrl}/demo/session/${this.sessionId}`, {
        method: 'DELETE'
      });
      this.sessionId = null;
    }
  }

  async health() {
    const response = await fetch(`${this.serverUrl}/health`);
    return await response.json();
  }
}

// Convenience function
async function executeDemo(demo, baseUrl = 'http://localhost:3031', serverUrl = 'http://localhost:3032') {
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
