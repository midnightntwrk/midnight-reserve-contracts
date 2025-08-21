const fs = require('fs');
const path = require('path');

// Test configuration
const DEMO_SERVER_URL = 'http://localhost:3042';
const TEST_DEMO_FILE = 'demo-flows/watch-test.demonb';
const TEST_OUTPUT_FILE = 'demo-flows/test-save-output.demonb';

async function testSaveFunctionality() {
  console.log('🧪 Starting automated save functionality test...\n');

  try {
    // Step 1: Load the original demo
    console.log('📖 Step 1: Loading original demo...');
    const originalDemo = JSON.parse(fs.readFileSync(TEST_DEMO_FILE, 'utf8'));
    console.log(`   Loaded demo: ${originalDemo.name}`);
    console.log(`   Stanzas: ${originalDemo.stanzas.length}`);

    // Step 2: Initialize demo session
    console.log('\n🚀 Step 2: Initializing demo session...');
    const initResponse = await fetch(`${DEMO_SERVER_URL}/demo/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        demo: originalDemo,
        baseUrl: 'http://localhost:3041' // Use correct baseUrl
      })
    });

    if (!initResponse.ok) {
      throw new Error(`Failed to initialize demo: ${initResponse.statusText}`);
    }

    const initResult = await initResponse.json();
    const sessionId = initResult.sessionId;
    console.log(`   Session created: ${sessionId}`);

    // Step 3: Make a test edit (modify the first code block)
    console.log('\n✏️  Step 3: Making test edit...');
    const modifiedDemo = JSON.parse(JSON.stringify(originalDemo)); // Deep copy
    
    // Find the first code block and modify it
    let foundCodeBlock = false;
    for (const stanza of modifiedDemo.stanzas) {
      for (const block of stanza.blocks) {
        if (block.type === 'code' && !foundCodeBlock) {
          // Add a test comment to the beginning
          const originalContent = Array.isArray(block.content) ? block.content : [block.content];
          block.content = [
            '// TEST EDIT: This line was added by automated test',
            ...originalContent
          ];
          foundCodeBlock = true;
          console.log(`   Modified code block in stanza: ${stanza.name}`);
          break;
        }
      }
      if (foundCodeBlock) break;
    }

    if (!foundCodeBlock) {
      throw new Error('No code block found to modify');
    }

    // Step 4: Test update endpoint (should work now)
    console.log('\n💾 Step 4: Testing update endpoint...');
    const updateResponse = await fetch(`${DEMO_SERVER_URL}/demo/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        sessionId: sessionId,
        demo: modifiedDemo
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to update demo: ${updateResponse.statusText} - ${errorText}`);
    }

    const updateResult = await updateResponse.json();
    console.log(`   ✅ Update result: ${updateResult.message}`);

    // Step 5: Test save endpoint (should work now)
    console.log('\n💾 Step 5: Testing save endpoint...');
    const saveResponse = await fetch(`${DEMO_SERVER_URL}/demo/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        sessionId: sessionId,
        filename: 'test-save-output.demonb'
      })
    });

    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();
      throw new Error(`Failed to save demo: ${saveResponse.statusText} - ${errorText}`);
    }

    const saveResult = await saveResponse.json();
    console.log(`   ✅ Save result: ${saveResult.message}`);
    console.log(`   Saved to: ${saveResult.path}`);

    // Step 6: Verify the file was written correctly
    console.log('\n🔍 Step 6: Verifying saved file...');
    if (!fs.existsSync(TEST_OUTPUT_FILE)) {
      throw new Error(`Saved file not found: ${TEST_OUTPUT_FILE}`);
    }

    const savedDemo = JSON.parse(fs.readFileSync(TEST_OUTPUT_FILE, 'utf8'));
    console.log(`   File exists and is valid JSON`);
    console.log(`   Saved demo name: ${savedDemo.name}`);

    // Step 7: Verify our edit was preserved
    console.log('\n✅ Step 7: Verifying edit was preserved...');
    let editFound = false;
    for (const stanza of savedDemo.stanzas) {
      for (const block of stanza.blocks) {
        if (block.type === 'code' && Array.isArray(block.content)) {
          if (block.content[0] === '// TEST EDIT: This line was added by automated test') {
            editFound = true;
            console.log(`   ✅ Edit found in stanza: ${stanza.name}`);
            break;
          }
        }
      }
      if (editFound) break;
    }

    if (!editFound) {
      throw new Error('Test edit was not preserved in saved file');
    }

    // Step 8: Test reloading the saved file
    console.log('\n🔄 Step 8: Testing reload of saved file...');
    const reloadResponse = await fetch(`${DEMO_SERVER_URL}/demo/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        demo: savedDemo,
        baseUrl: 'http://localhost:3041'
      })
    });

    if (!reloadResponse.ok) {
      throw new Error(`Failed to reload saved demo: ${reloadResponse.statusText}`);
    }

    const reloadResult = await reloadResponse.json();
    console.log(`   ✅ Reload successful: ${reloadResult.sessionId}`);

    // Cleanup
    console.log('\n🧹 Cleanup: Removing test file...');
    if (fs.existsSync(TEST_OUTPUT_FILE)) {
      fs.unlinkSync(TEST_OUTPUT_FILE);
      console.log('   Test file removed');
    }

    console.log('\n🎉 SUCCESS: All save functionality tests passed!');
    console.log('\nTest Summary:');
    console.log('✅ Demo loaded successfully');
    console.log('✅ Session initialized');
    console.log('✅ Demo updated on server');
    console.log('✅ Demo saved to disk');
    console.log('✅ Edit preserved in saved file');
    console.log('✅ Saved file can be reloaded');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Check if demo server is running
async function checkServerHealth() {
  try {
    console.log(`Checking health at: ${DEMO_SERVER_URL}/health`);
    const response = await fetch(`${DEMO_SERVER_URL}/health`);
    console.log(`Response status: ${response.status}`);
    if (response.ok) {
      const healthData = await response.json();
      console.log('✅ Demo server is running');
      console.log(`   Active sessions: ${healthData.activeSessions}`);
      return true;
    } else {
      console.log(`❌ Health check failed with status: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Demo server is not running or not accessible');
    console.error('   Error:', error.message);
    console.error('   Please start the demo server with: bun run demo:start');
    return false;
  }
}

// Main execution
async function main() {
  console.log('🔍 Checking demo server health...');
  const serverHealthy = await checkServerHealth();
  
  if (!serverHealthy) {
    process.exit(1);
  }

  await testSaveFunctionality();
}

// Run the test
main().catch(console.error);
