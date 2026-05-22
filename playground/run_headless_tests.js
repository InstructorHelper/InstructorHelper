const { spawn } = require('child_process');
const http = require('http');

async function main() {
  console.log("Starting Chrome in headless mode...");
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless',
    '--disable-gpu',
    '--remote-debugging-port=9222',
    '--remote-allow-origins=*'
  ]);

  // Handle sudden exit
  chromeProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`Chrome process exited with code ${code}`);
    }
  });

  // Wait for remote debugging to be ready
  await new Promise(r => setTimeout(r, 2000));

  try {
    console.log("Fetching target list from Chrome...");
    const targets = await getJson('http://127.0.0.1:9222/json/list');
    if (!targets || targets.length === 0) {
      throw new Error("No active Chrome targets found");
    }
    
    // Connect to the first page target
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) {
      throw new Error("No page target found");
    }
    
    const wsUrl = pageTarget.webSocketDebuggerUrl;
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    
    const ws = new WebSocket(wsUrl);
    
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    
    console.log("Connected to Chrome via WebSocket.");
    
    // Enable runtime
    let msgId = 1;
    ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.enable' }));
    
    // Navigate
    const targetUrl = 'http://localhost:8000/playground/playground.html?run_tests=true';
    console.log(`Navigating to ${targetUrl}`);
    ws.send(JSON.stringify({
      id: msgId++,
      method: 'Page.navigate',
      params: { url: targetUrl }
    }));
    
    // Poll the container text
    console.log("Polling test results...");
    let attempts = 0;
    const maxAttempts = 30; // 15 seconds
    let finalOutput = '';
    
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 500));
      attempts++;
      
      const evalId = msgId++;
      const evalPromise = new Promise((resolve) => {
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === evalId) {
            ws.removeEventListener('message', handler);
            resolve(data.result?.result?.value || '');
          }
        };
        ws.addEventListener('message', handler);
      });
      
      ws.send(JSON.stringify({
        id: evalId,
        method: 'Runtime.evaluate',
        params: {
          expression: "document.getElementById('test-results-container').innerText"
        }
      }));
      
      const resultsText = await evalPromise;
      if (resultsText) {
        finalOutput = resultsText;
        if (resultsText.includes('Result:') || resultsText.includes('Run Error:')) {
          break;
        }
      }
    }
    
    console.log("\n=================== TEST RESULTS ===================");
    console.log(finalOutput || "No test results captured.");
    console.log("====================================================\n");
    
    ws.close();
    
    if (finalOutput.includes('FAILED') || finalOutput.includes('Run Error:') || !finalOutput.includes('passed')) {
      console.error("Tests failed!");
      process.exit(1);
    } else {
      console.log("All tests passed successfully!");
      process.exit(0);
    }
    
  } catch (err) {
    console.error("Error running headless tests:", err);
    process.exit(1);
  } finally {
    console.log("Terminating Chrome...");
    chromeProcess.kill();
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

main();
