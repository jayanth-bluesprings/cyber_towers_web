/**
 * Generates CyberTowers_System_Status_And_How_It_Works.docx
 * A detailed document: verified test results, controller connectivity status,
 * how the whole system works, data flow, and how to connect a controller.
 */
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  TableOfContents, PageBreak, LevelFormat, Header, Footer, PageNumber,
} = require('docx');

const NAVY = '1F3864', BLUE = '2E75B6', GREY = 'F2F2F2', RED = 'C00000', GREEN = '548235', AMBER = 'BF8F00';
const CONTENT_W = 9360;
const border = { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' };
const borders = { top: border, left: border, bottom: border, right: border };

const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const p = (t, o = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, ...o })] });
const spacer = () => new Paragraph({ spacing: { after: 80 }, children: [] });
const bullet = (t, level = 0) => new Paragraph({ numbering: { reference: 'bullets', level }, spacing: { after: 60 }, children: [new TextRun(t)] });
const numbered = (t, ref = 'steps') => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 80 }, children: [new TextRun(t)] });

function code(lines) {
  const arr = Array.isArray(lines) ? lines : [lines];
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
    rows: [new TableRow({ children: [new TableCell({
      borders, width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: '1E1E1E', type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [new Paragraph({ children: arr.map((l, i) => new TextRun({ text: l, font: 'Consolas', size: 18, color: 'D4D4D4', break: i > 0 ? 1 : 0 })) })],
    })] })],
  });
}
function callout(label, text, color) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 1, color }, left: { style: BorderStyle.SINGLE, size: 18, color }, bottom: { style: BorderStyle.SINGLE, size: 1, color }, right: { style: BorderStyle.SINGLE, size: 1, color } },
      width: { size: CONTENT_W, type: WidthType.DXA }, shading: { fill: GREY, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [new Paragraph({ children: [new TextRun({ text: `${label}  `, bold: true, color }), new TextRun({ text, size: 20 })] })],
    })] })],
  });
}
function table(headers, rows, widths) {
  const cols = widths || headers.map(() => Math.floor(CONTENT_W / headers.length));
  const headerRow = new TableRow({ tableHeader: true, children: headers.map((htext, i) => new TableCell({
    borders, width: { size: cols[i], type: WidthType.DXA }, shading: { fill: NAVY, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: htext, bold: true, color: 'FFFFFF', size: 20 })] })],
  })) });
  const bodyRows = rows.map((r, ri) => new TableRow({ children: r.map((cell, ci) => {
    // allow [text, color] for status cells
    const txt = Array.isArray(cell) ? cell[0] : cell;
    const col = Array.isArray(cell) ? cell[1] : '000000';
    const bold = Array.isArray(cell);
    return new TableCell({
      borders, width: { size: cols[ci], type: WidthType.DXA },
      shading: { fill: ri % 2 ? GREY : 'FFFFFF', type: ShadingType.CLEAR },
      margins: { top: 50, bottom: 50, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: String(txt), size: 19, color: col, bold })] })],
    });
  }) }));
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: cols, rows: [headerRow, ...bodyRows] });
}

const children = [];

// Cover
children.push(
  new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'CyberTowers', bold: true, size: 72, color: NAVY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Vehicle Access Dashboard', bold: true, size: 40, color: BLUE })] }),
  new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'System Status & How It Works', size: 30, color: '404040' })] }),
  new Paragraph({ spacing: { before: 1000 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Verified test results, architecture, data flow,', italics: true, size: 22, color: '595959' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'and controller-connection status', italics: true, size: 22, color: '595959' })] }),
  new Paragraph({ spacing: { before: 1600 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Bluesprings AI', bold: true, size: 22, color: NAVY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Test performed: 18 June 2026  ·  Version 1.0', size: 20, color: '808080' })] }),
  new Paragraph({ children: [new PageBreak()] }),
);

// TOC
children.push(h1('Table of Contents'));
children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1. Executive summary
children.push(h1('1. Executive Summary'));
children.push(p('This document reports the verified status of the CyberTowers Vehicle Access Dashboard on the installed laptop, explains how every part of the system works, traces the live data flow, and states exactly what is required to connect a physical door controller.'));
children.push(p('Result of testing (18 June 2026): the software stack — web dashboard, backend API, real-time feed, and PostgreSQL database — is fully operational. No physical controller is connected yet, because the hardware Bridge layer has not been deployed and no controllers have been added. This is the normal state of a fresh software installation.'));
children.push(callout('BOTTOM LINE:', 'The dashboard works end-to-end. To bring live door/vehicle data in, the Bridge Service must be deployed on a machine on the controllers\' network and controllers added (Section 7).', BLUE));

// 2. Test results
children.push(h1('2. Verified Test Results'));
children.push(h2('2.1 Core services'));
children.push(table(
  ['Check', 'Result', 'Detail'],
  [
    ['Backend server (:5000)', ['RUNNING', GREEN], 'Health endpoint returns status ok'],
    ['Database connectivity', ['OK', GREEN], 'Health reports db = ok'],
    ['PostgreSQL 18 service', ['RUNNING', GREEN], 'Startup type Automatic (starts on boot)'],
    ['Frontend build', ['OK', GREEN], 'Built with API key embedded'],
    ['Node dependencies', ['OK', GREEN], 'Installed for backend and frontend'],
    ['Database migrations', ['APPLIED', GREEN], '2 of 2 migrations recorded'],
  ],
  [3000, 1700, 4660],
));
children.push(spacer());
children.push(h2('2.2 Security & API'));
children.push(table(
  ['Check', 'Result', 'Detail'],
  [
    ['API call without key', ['BLOCKED (401)', GREEN], 'Authentication is enforced'],
    ['API call with valid key', ['ALLOWED (200)', GREEN], 'Key in backend and frontend match'],
    ['/api/controllers', ['200', GREEN], 'Controller management endpoint'],
    ['/api/cards', ['200', GREEN], 'Card management endpoint'],
    ['/api/events/stats', ['200', GREEN], 'Scan-event statistics'],
    ['/api/access-groups', ['200', GREEN], 'Access-group endpoint'],
    ['/api/monitoring/overview', ['200', GREEN], 'Bridge monitoring dashboard'],
    ['/api/users', ['200', GREEN], 'User directory'],
  ],
  [3000, 1900, 4460],
));

// 3. Controller connectivity
children.push(h1('3. Controller Connectivity Status'));
children.push(p('A physical FC8900 controller is NOT connected to this laptop at this time. The table below shows each prerequisite and its current state.'));
children.push(table(
  ['Requirement', 'Status'],
  [
    ['Controllers added in the dashboard', ['0 configured', RED]],
    ['Bridge Windows Service installed', ['Not installed', RED]],
    ['Bridge application compiled (.exe)', ['Not built', RED]],
    ['Real FC8900SDK.dll present', ['Missing (dev stub only)', RED]],
    ['Heartbeats received from any controller', ['0', RED]],
    ['Scan events recorded', ['0', RED]],
    ['.NET 8 runtime (needed to run the Bridge)', ['Available (8.0.422)', GREEN]],
  ],
  [6360, 3000],
));
children.push(spacer());
children.push(callout('WHY:', 'A browser cannot talk to door hardware directly. The Bridge Service is the component that discovers controllers, reads/writes cards, and streams events to the dashboard. Until it is deployed on the controllers\' LAN, no controller can connect. See Section 7 to enable it.', AMBER));

// 4. Architecture
children.push(h1('4. How the System Is Built'));
children.push(p('The system has four layers. Only the first three run on the dashboard laptop; the Bridge runs wherever it can reach the controllers.'));
children.push(table(
  ['Layer', 'Technology', 'Responsibility'],
  [
    ['Web dashboard (UI)', 'React + Vite + Tailwind', 'Screens for cards, controllers, events, monitoring, reports'],
    ['Backend API + realtime', 'Node.js + Express + WebSocket', 'REST API, authentication, live event stream, serves the UI'],
    ['Database', 'PostgreSQL 14+', 'Stores cards, controllers, events, users, access groups'],
    ['Bridge Service', '.NET 8 Windows Service (C#)', 'Talks to FC8900 controllers; relays cards and events'],
  ],
  [2400, 2700, 4260],
));
children.push(spacer());
children.push(h2('4.1 Component diagram'));
children.push(code([
  '   Browser (dashboard)',
  '        |  HTTPS + WebSocket',
  '        v',
  '   Node.js backend  <----- PostgreSQL (cards, events, controllers)',
  '        ^',
  '        |  localhost HTTP (/internal/bridge/*)',
  '        |',
  '   Bridge Service (.NET, Windows)',
  '        |  TCP / UDP on the LAN',
  '        v',
  '   FC8900 door controllers  ->  card readers / gates',
]));

// 5. What each part does
children.push(h1('5. What Each Part Does'));
children.push(h2('5.1 Web dashboard'));
children.push(bullet('Vehicles & Cards — register cards, assign people/vehicles, push or remove cards from controllers.'));
children.push(bullet('Controllers — add controllers, see live online/offline health.'));
children.push(bullet('Events — searchable, paginated access log that updates live as scans arrive.'));
children.push(bullet('Access Groups — define which controllers a card is allowed on.'));
children.push(bullet('Bridge Monitor — live view of controller health, push queue, sync activity, alerts.'));
children.push(bullet('Reports & Live Entry/Exit — occupancy, vehicle stats, and the real-time gate feed.'));
children.push(h2('5.2 Backend API'));
children.push(bullet('Exposes /api/* routes (protected by an API key) for the dashboard.'));
children.push(bullet('Exposes /internal/bridge/* routes (localhost only) that the Bridge calls.'));
children.push(bullet('Broadcasts every new scan, status change, and push result over WebSocket so screens update instantly.'));
children.push(bullet('Validates configuration at startup and refuses to start in production with weak secrets.'));
children.push(h2('5.3 Database'));
children.push(bullet('PostgreSQL schema "cybertowers" holds all persistent data.'));
children.push(bullet('Migrations are tracked so upgrades apply new tables/columns exactly once.'));
children.push(h2('5.4 Bridge Service'));
children.push(bullet('Discovers controllers on the LAN (UDP broadcast) and reports them to the backend.'));
children.push(bullet('Sends a heartbeat for each controller so the dashboard can show online/offline.'));
children.push(bullet('Writes cards to controllers (WriteCardMain) and removes them (DelCardMain).'));
children.push(bullet('Streams live scan events and syncs historical records into the database.'));

// 6. Data flow
children.push(h1('6. How a Card Scan Flows (End to End)'));
children.push(numbered('A person presents their card at a gate reader wired to an FC8900 controller.'));
children.push(numbered('The controller decides allow/deny and records the event.'));
children.push(numbered('The Bridge Service (polling every ~2 seconds) reads the new event from the controller.'));
children.push(numbered('The Bridge POSTs the event to the backend at /internal/bridge/events.'));
children.push(numbered('The backend saves it to PostgreSQL and broadcasts it over WebSocket.'));
children.push(numbered('Open dashboards receive the broadcast and show the scan instantly on the Events and Live Entry/Exit screens.'));
children.push(spacer());
children.push(p('Pushing a card works in reverse: the dashboard queues the card, the Bridge picks up the job, writes it to each controller, verifies it, and reports success — which the dashboard shows as a live status change.'));

// 7. Connecting a controller
children.push(h1('7. How to Connect a Controller'));
children.push(p('Perform these on a Windows machine that is on the same network as the controllers (this can be the same laptop if it is on that LAN).', { italics: true }));
children.push(h2('7.1 Prerequisites'));
children.push(bullet('.NET 8 runtime (x86) — already present on this laptop (8.0.422).'));
children.push(bullet('The real FC8900SDK.dll from the controller vendor (the project currently ships only a development stub).'));
children.push(bullet('The controller\'s IP address, TCP/UDP ports, and password.'));
children.push(h2('7.2 Steps'));
children.push(numbered('Place the vendor FC8900SDK.dll into the bridge project so it is copied to the build output.'));
children.push(numbered('Build and install the Bridge as a Windows service:'));
children.push(code(['cd bridge', 'powershell -ExecutionPolicy Bypass -File install-service.ps1 -Action install -ExpressUrl http://localhost:5000']));
children.push(numbered('In the dashboard, open Configuration -> Controllers -> Add Controller and enter the serial number, IP, ports, password, and door labels.'));
children.push(numbered('Within ~30 seconds the controller appears Online in the Controllers tab and the Bridge Monitor.'));
children.push(numbered('Add cards and use "Push" / "Sync All" to write them to the controller; scans will then stream into Events.'));
children.push(spacer());
children.push(callout('DEVELOPMENT OPTION:', 'The Bridge can run with UseStubSdk=true to simulate a controller without hardware — useful for demos. Live hardware requires the real SDK DLL.', BLUE));

// 8. Current data inventory
children.push(h1('8. Current Data Inventory'));
children.push(p('A snapshot of stored data at test time. All zero, as expected for a fresh install.'));
children.push(table(
  ['Data', 'Count'],
  [['Controllers configured', '0'], ['Cards', '0'], ['Scan events', '0'], ['Access groups', 'see dashboard'], ['Users', 'see dashboard']],
  [6360, 3000],
));

// 9. Daily operation / restart
children.push(h1('9. Daily Operation & Restart'));
children.push(bullet('PostgreSQL starts automatically when the laptop boots — no action needed.'));
children.push(bullet('The dashboard does NOT auto-start. After a restart, double-click "Bluesprings MyAccess.vbs" in the project root; it rebuilds the UI, starts the backend, and opens the browser.'));
children.push(bullet('Confirm health any time by visiting http://localhost:5000/health (expect status ok, db ok).'));
children.push(bullet('Take regular database backups with backend/database/backup.ps1.'));
children.push(spacer());
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 }, children: [new TextRun({ text: '— End of Document —', italics: true, color: '808080', size: 20 })] }));

// assemble
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, color: NAVY },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, color: BLUE }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'CyberTowers — System Status & How It Works', size: 16, color: '808080' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', size: 16, color: '808080' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '808080' })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync('CyberTowers_System_Status_And_How_It_Works.docx', buf);
  console.log('Wrote CyberTowers_System_Status_And_How_It_Works.docx (' + (buf.length / 1024).toFixed(1) + ' KB)');
});
