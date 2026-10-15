import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(scriptDir, '../IncidentLens-AMD-Presentation.html');
const pdfPath = resolve(scriptDir, '../IncidentLens-AMD-Presentation.pdf');

const html = readFileSync(htmlPath, 'utf8');
if (!html.includes('IncidentLens AMD')) {
  throw new Error(`Expected IncidentLens presentation HTML at: ${htmlPath}`);
}

async function openPrintTab(fileUrl) {
  const response = await fetch(
    `http://localhost:9222/json/new?${encodeURIComponent(fileUrl)}`,
    { method: 'PUT' },
  );
  if (!response.ok) {
    throw new Error(`Chrome CDP returned HTTP ${response.status}`);
  }
  return response.json();
}

async function generatePdf() {
  const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
  const tab = await openPrintTab(fileUrl);
  const socket = new WebSocket(tab.webSocketDebuggerUrl);

  await new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen;
    socket.onerror = rejectOpen;
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));

  socket.send(JSON.stringify({
    id: 1,
    method: 'Page.printToPDF',
    params: {
      printBackground: true,
      paperWidth: 11,
      paperHeight: 6.1875,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      landscape: true,
    },
  }));

  const message = await new Promise((resolveMessage) => {
    socket.onmessage = (event) => resolveMessage(JSON.parse(event.data));
  });
  const base64Data = message.result?.data;
  if (!base64Data) {
    throw new Error(`Chrome did not return PDF data: ${JSON.stringify(message)}`);
  }

  const pdf = Buffer.from(base64Data, 'base64');
  writeFileSync(pdfPath, pdf);
  socket.close();
  await fetch(`http://localhost:9222/json/close/${tab.id}`);
  console.log(`Generated ${pdfPath} (${pdf.length} bytes)`);
}

generatePdf().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
