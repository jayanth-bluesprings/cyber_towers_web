/**
 * Generates CyberTowers_Installation_Guide.docx — a crystal-clear, from-scratch
 * setup guide for installing the Vehicle Access Dashboard on a new laptop/server.
 */
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  TableOfContents, PageBreak, LevelFormat, Header, Footer, PageNumber,
} = require('docx');

const NAVY = '1F3864';
const BLUE = '2E75B6';
const LIGHT = 'D9E2F3';
const GREY = 'F2F2F2';
const RED = 'C00000';
const GREEN = '548235';
const CONTENT_W = 9360;

// ── helpers ──────────────────────────────────────────────────────────────────
const border = { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' };
const borders = { top: border, left: border, bottom: border, right: border };

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, ...opts })],
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 60 },
    children: typeof text === 'string' ? [new TextRun(text)] : text,
  });
}
function numbered(text, ref = 'steps') {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80 },
    children: typeof text === 'string' ? [new TextRun(text)] : text,
  });
}
function code(lines) {
  const arr = Array.isArray(lines) ? lines : [lines];
  // Render the code block as a single-cell table so we get a clean border in the
  // schema-correct order (tcBorders), plus the dark shading for readability.
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [new TableRow({ children: [new TableCell({
      borders,
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: '1E1E1E', type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [new Paragraph({ children: arr.map((l, i) => new TextRun({
        text: l, font: 'Consolas', size: 18, color: 'D4D4D4', break: i > 0 ? 1 : 0,
      })) })],
    })] })],
  });
}
function callout(label, text, color) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 1, color },
        left: { style: BorderStyle.SINGLE, size: 18, color },
        bottom: { style: BorderStyle.SINGLE, size: 1, color },
        right: { style: BorderStyle.SINGLE, size: 1, color } },
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: GREY, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [new Paragraph({ children: [
        new TextRun({ text: `${label}  `, bold: true, color }),
        new TextRun({ text, size: 20 }),
      ] })],
    })] })],
  });
}
function spacer() { return new Paragraph({ spacing: { after: 80 }, children: [] }); }

// table with header row + body rows (array of arrays)
function table(headers, rows, widths) {
  const cols = widths || headers.map(() => Math.floor(CONTENT_W / headers.length));
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((htext, i) => new TableCell({
      borders, width: { size: cols[i], type: WidthType.DXA },
      shading: { fill: NAVY, type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: htext, bold: true, color: 'FFFFFF', size: 20 })] })],
    })),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((cell, ci) => new TableCell({
      borders, width: { size: cols[ci], type: WidthType.DXA },
      shading: { fill: ri % 2 ? GREY : 'FFFFFF', type: ShadingType.CLEAR },
      margins: { top: 50, bottom: 50, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: String(cell), size: 19 })] })],
    })),
  }));
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: cols,
    rows: [headerRow, ...bodyRows],
  });
}

// ── document body ──────────────────────────────────────────────────────────
const children = [];

// Cover
children.push(
  new Paragraph({ spacing: { before: 2400, after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'CyberTowers', bold: true, size: 72, color: NAVY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Vehicle Access Dashboard', bold: true, size: 44, color: BLUE })] }),
  new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Complete Installation & Setup Guide', size: 30, color: '404040' })] }),
  new Paragraph({ spacing: { before: 1200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'How to set up the system on a new laptop or server', italics: true, size: 22, color: '595959' })] }),
  new Paragraph({ spacing: { before: 1600 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Bluesprings AI', bold: true, size: 22, color: NAVY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Version 1.0  ·  June 2026', size: 20, color: '808080' })] }),
  new Paragraph({ children: [new PageBreak()] }),
);

// TOC
children.push(h1('Table of Contents'));
children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1. Overview
children.push(h1('1. What You Are Installing'));
children.push(p('The CyberTowers Vehicle Access Dashboard is a web application that lets staff manage RFID access cards, monitor vehicle entry/exit in real time, view reports, and (optionally) push cards to physical FC8900 door controllers.'));
children.push(p('The system has three parts. For a basic dashboard on a laptop you only need the first two; the third is only required when connecting to physical controllers.'));
children.push(table(
  ['Component', 'What it does', 'Required?'],
  [
    ['Backend (Node.js)', 'Serves the web app, the API, and the live WebSocket feed. Talks to PostgreSQL.', 'Yes'],
    ['PostgreSQL database', 'Stores cards, controllers, scan events, users, and settings.', 'Yes'],
    ['Bridge Service (.NET)', 'Runs on the LAN with the FC8900 controllers and relays card/event data. Hardware only.', 'Only with hardware'],
  ],
  [2400, 5160, 1800],
));
children.push(spacer());
children.push(callout('IN PLAIN TERMS:', 'On each laptop you install Node.js and PostgreSQL once, copy the project folder, set a few configuration values, then double-click the launcher. The browser opens the dashboard automatically.', BLUE));

// 2. Requirements
children.push(h1('2. System Requirements'));
children.push(h2('2.1 Hardware (minimum)'));
children.push(table(
  ['Resource', 'Minimum', 'Recommended'],
  [['CPU', 'Dual-core', 'Quad-core'], ['RAM', '4 GB', '8 GB+'], ['Disk', '2 GB free', '10 GB+ free'], ['Network', 'LAN access to the database', 'Wired LAN for controllers']],
  [2400, 3480, 3480],
));
children.push(spacer());
children.push(h2('2.2 Software'));
children.push(table(
  ['Software', 'Version', 'Notes'],
  [
    ['Windows', '10 / 11 or Server 2019+', 'The launcher and Bridge are Windows-based'],
    ['Node.js', '18 LTS or 20 LTS', 'Includes npm. Download from nodejs.org'],
    ['PostgreSQL', '14 or newer', 'Includes pgAdmin. Download from postgresql.org'],
    ['.NET Runtime', '8.0 (x86)', 'ONLY on the machine running the Bridge'],
    ['Web browser', 'Chrome / Edge (latest)', 'To open the dashboard'],
  ],
  [2200, 2400, 4760],
));
children.push(spacer());
children.push(callout('TIP:', 'When installing Node.js, accept all defaults. When installing PostgreSQL, remember the password you set for the "postgres" user — you will need it in Step 4.', GREEN));

// 3. Install prerequisites
children.push(h1('3. Step 1 — Install the Prerequisites'));
children.push(p('Do this once per laptop.', { italics: true }));
children.push(numbered('Install Node.js (LTS) from https://nodejs.org — accept defaults.'));
children.push(numbered('Install PostgreSQL from https://www.postgresql.org/download/windows/ — during setup, set and WRITE DOWN the password for the "postgres" superuser. Keep the default port 5432.'));
children.push(numbered('Verify both installs by opening PowerShell and running the commands below. Each should print a version number.'));
children.push(code(['node --version', 'npm --version', 'psql --version']));
children.push(callout('IF psql IS NOT FOUND:', 'Add PostgreSQL\'s bin folder (e.g. C:\\Program Files\\PostgreSQL\\16\\bin) to the Windows PATH, then reopen PowerShell.', RED));

// 4. Copy project
children.push(h1('4. Step 2 — Copy the Project Files'));
children.push(numbered('Copy the entire project folder (the one containing the "backend", "frontend", and "bridge" sub-folders) to the new laptop — for example to C:\\apps\\vehicle-access-dashboard.'));
children.push(numbered('Do NOT copy the "node_modules" folders if they exist — they will be re-created automatically and are large. Everything else is needed.'));
children.push(callout('IMPORTANT:', 'The two ".env" configuration files (backend\\.env and frontend\\.env) are NOT included in a clean copy for security reasons. You will create them in Step 4.', RED));

// 5. Database setup
children.push(h1('5. Step 3 — Create the Database'));
children.push(p('You will create an empty database, enable two extensions, load the schema, and apply migrations.'));
children.push(h2('5.1 Create the database'));
children.push(p('Open pgAdmin (or PowerShell) and run, as the postgres user:'));
children.push(code(['createdb -U postgres cybertowers_access']));
children.push(p('Or in pgAdmin: right-click Databases → Create → Database → name it cybertowers_access.'));
children.push(h2('5.2 Load the schema'));
children.push(p('From inside the project\'s "backend" folder, run:'));
children.push(code([
  'cd C:\\apps\\vehicle-access-dashboard\\backend',
  'psql -U postgres -d cybertowers_access -f database\\cybertowers_access_schema.sql',
]));
children.push(p('This creates the "cybertowers" schema, all tables, and enables the pgcrypto and pg_trgm extensions automatically.'));
children.push(h2('5.3 Apply migrations'));
children.push(p('Migrations add later columns and tables (card push tracking, user assignment). This step is required — skipping it causes "relation does not exist" errors.'));
children.push(code(['npm install', 'npm run migrate']));
children.push(p('You should see "Applied 2 migration(s)" (or "database is up to date" if already applied). Check status anytime with:'));
children.push(code(['npm run migrate:status']));

// 6. Configuration
children.push(h1('6. Step 4 — Configure the Environment'));
children.push(p('Two small text files hold all settings. Create them with Notepad.'));
children.push(h2('6.1 Backend configuration (backend\\.env)'));
children.push(p('Copy backend\\.env.example to backend\\.env, then edit the values:'));
children.push(code([
  'PORT=5000',
  'API_KEY=<paste a long random secret here>',
  '',
  'PG_HOST=localhost',
  'PG_PORT=5432',
  'PG_DATABASE=cybertowers_access',
  'PG_USER=postgres',
  'PG_PASSWORD=<the postgres password from Step 1>',
]));
children.push(p('Generate a strong API key by running this in PowerShell and pasting the output:'));
children.push(code(['node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"']));
children.push(h2('6.2 Frontend configuration (frontend\\.env)'));
children.push(p('Create frontend\\.env with these two lines. The API key MUST be identical to the backend one, or every request will fail with "Unauthorized".'));
children.push(code([
  'VITE_API_URL=http://localhost:5000',
  'VITE_API_KEY=<the SAME key as backend API_KEY>',
]));
children.push(spacer());
children.push(callout('THE #1 MISTAKE:', 'The API_KEY in backend\\.env and the VITE_API_KEY in frontend\\.env must match exactly, and VITE_API_URL must point to the backend port (5000). If the dashboard loads but shows no data, check these three values first.', RED));

// 7. Run
children.push(h1('7. Step 5 — Start the Dashboard'));
children.push(h2('7.1 Easiest way — the launcher'));
children.push(p('Double-click "Bluesprings MyAccess.vbs" in the project root. It automatically installs dependencies, builds the frontend, starts the server, and opens your browser at the dashboard. The first run takes a few minutes; later runs are quick.'));
children.push(h2('7.2 Manual way (for troubleshooting)'));
children.push(p('Run these in PowerShell from the project root:'));
children.push(code([
  '# 1. Build the frontend',
  'cd frontend',
  'npm install',
  'npm run build',
  '',
  '# 2. Start the backend (also serves the built frontend)',
  'cd ..\\backend',
  'npm install',
  'npm start',
]));
children.push(p('Then open a browser to:'));
children.push(code(['http://localhost:5000']));
children.push(h2('7.3 Confirm it is healthy'));
children.push(p('Visit the health endpoint. You should see status "ok" and db "ok".'));
children.push(code(['http://localhost:5000/health']));

// 8. Adding controllers
children.push(h1('8. Adding Door Controllers (Optional)'));
children.push(p('Controllers are only needed when connecting to physical FC8900 hardware. There are two ways to add them.'));
children.push(h2('8.1 Manual (recommended)'));
children.push(bullet('Open the dashboard → Configuration → Controllers tab → "Add Controller".'));
children.push(bullet('Enter the serial number, IP address, TCP/UDP ports, password, and door labels.'));
children.push(bullet('This is the reliable method and is required anyway, because the controller password must be entered by hand.'));
children.push(h2('8.2 Automatic discovery'));
children.push(p('If the Bridge Service is installed and running on the same LAN as the controllers, it broadcasts a UDP probe and pre-fills any controllers that respond. They still need to be edited afterward to add the password and location.'));
children.push(callout('NOTE:', 'Auto-discovery requires the Bridge Service running on the controller network and should be validated against your actual FC8900 firmware. For most setups, add controllers manually.', BLUE));

// 9. Moving to another laptop (summary)
children.push(h1('9. Quick Checklist for a New Laptop'));
children.push(numbered('Install Node.js and PostgreSQL (Step 1).', 'check'));
children.push(numbered('Copy the project folder over, excluding node_modules (Step 2).', 'check'));
children.push(numbered('Create the database, load schema, run migrations (Step 3).', 'check'));
children.push(numbered('Create backend\\.env and frontend\\.env with matching API keys (Step 4).', 'check'));
children.push(numbered('Double-click the launcher, or build + npm start (Step 5).', 'check'));
children.push(numbered('Open http://localhost:5000 and verify /health shows db "ok".', 'check'));

// 10. Backups & maintenance
children.push(h1('10. Backups & Maintenance'));
children.push(h2('10.1 Database backup'));
children.push(p('A backup script is included. From the backend folder:'));
children.push(code(['powershell -ExecutionPolicy Bypass -File database\\backup.ps1']));
children.push(p('It writes a compressed backup to backend\\database\\backups and keeps 14 days. To restore:'));
children.push(code(['powershell -File database\\backup.ps1 -Restore -File database\\backups\\<file>.dump']));
children.push(h2('10.2 Upgrading to a newer version'));
children.push(code([
  'cd backend',
  'npm install',
  'npm run migrate',
  'cd ..\\frontend',
  'npm install',
  'npm run build',
  '# then restart the server / launcher',
]));

// 11. Troubleshooting
children.push(h1('11. Troubleshooting'));
children.push(table(
  ['Symptom', 'Likely cause', 'Fix'],
  [
    ['Dashboard loads but no data; 401 errors', 'API keys do not match', 'Make backend API_KEY = frontend VITE_API_KEY; rebuild frontend'],
    ['"relation ... does not exist"', 'Migrations not applied', 'Run npm run migrate in the backend folder'],
    ['/health shows db "down"', 'Wrong DB credentials or PG not running', 'Check PG_* values in backend\\.env; ensure PostgreSQL service is running'],
    ['psql / pg_dump not found', 'PostgreSQL bin not on PATH', 'Add C:\\Program Files\\PostgreSQL\\<ver>\\bin to PATH'],
    ['Port 5000 already in use', 'Another instance running', 'Close the old server, or change PORT in backend\\.env'],
    ['Controllers show "Offline"', 'No Bridge heartbeats', 'Ensure the Bridge Service is running and can reach the backend'],
  ],
  [2700, 2700, 3960],
));

// 12. Security notes
children.push(h1('12. Security Notes'));
children.push(bullet('Never share or commit the .env files — they contain the database password and API key.'));
children.push(bullet('Use a long, random API_KEY (32+ characters). Treat it like a password.'));
children.push(bullet('For internet-facing deployments set NODE_ENV=production, list real ALLOWED_ORIGINS, put the app behind HTTPS, and never expose PostgreSQL publicly.'));
children.push(bullet('Take regular database backups (Section 10) and store them securely.'));
children.push(spacer());
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 },
  children: [new TextRun({ text: '— End of Guide —', italics: true, color: '808080', size: 20 })] }));

// ── assemble ─────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, color: NAVY },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, color: BLUE },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ] },
      { reference: 'steps', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ] },
      { reference: 'check', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: 'CyberTowers Vehicle Access Dashboard — Installation Guide', size: 16, color: '808080' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Page ', size: 16, color: '808080' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '808080' })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync('CyberTowers_Installation_Guide.docx', buf);
  console.log('Wrote CyberTowers_Installation_Guide.docx (' + (buf.length / 1024).toFixed(1) + ' KB)');
});
