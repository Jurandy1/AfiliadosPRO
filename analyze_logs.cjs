const fs = require('fs');
try {
  const data = JSON.parse(fs.readFileSync('downloaded-logs-20260622-114058.json', 'utf8'));

  const severityCount = {};
  const functionCount = {};
  const errorMessages = [];
  const uniqueErrors = new Set();
  
  let firstLog = data[data.length - 1]?.timestamp;
  let lastLog = data[0]?.timestamp;

  data.forEach(log => {
    const sev = log.severity || 'UNKNOWN';
    severityCount[sev] = (severityCount[sev] || 0) + 1;
    
    const fnName = log.resource?.labels?.service_name || log.labels?.['goog-drz-cloudfunctions-id'] || 'unknown';
    functionCount[fnName] = (functionCount[fnName] || 0) + 1;
    
    if (sev === 'ERROR' || sev === 'WARNING' || sev === 'CRITICAL') {
      let msg = log.textPayload || log.jsonPayload?.message || JSON.stringify(log.jsonPayload);
      if (msg) {
        // truncate msg to avoid massive sets
        const shortMsg = msg.substring(0, 200);
        if (!uniqueErrors.has(shortMsg)) {
          uniqueErrors.add(shortMsg);
          errorMessages.push({ sev, fnName, time: log.timestamp, msg: shortMsg });
        }
      }
    }
  });

  console.log(`Logs from ${firstLog} to ${lastLog}`);
  console.log('--- Severity Counts ---');
  console.log(severityCount);
  console.log('--- Function Counts ---');
  console.log(functionCount);
  console.log('--- Top Unique Errors/Warnings ---');
  errorMessages.slice(0, 20).forEach(e => {
    console.log(`[${e.sev}] ${e.fnName} @ ${e.time}: ${e.msg}`);
  });
} catch (e) {
  console.error("Failed to parse logs:", e);
}
