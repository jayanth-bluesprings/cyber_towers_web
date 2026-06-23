// CyberTowers Setup Guide generator — run with:
//   NODE_PATH="D:\npm-global\node_modules" node gen_setup_guide.js
// or if docx is installed locally: node gen_setup_guide.js

const docx = require('docx');
const fs   = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, ExternalHyperlink,
  LevelFormat, TableOfContents,
} = docx;

// ─── CONSTANTS ────────────────────────────────────────────────
const PAGE_W    = 12240; // US Letter 8.5"
const PAGE_H    = 15840; // 11"
const CONTENT_W = 9360;  // 6.5" content area (1" margins each side)
const MARGIN    = 1440;

const BLUE  = '1E3A5F';
const AMBER = 'FFF3CD';
const AMBRB = 'FFC107';
const GREYB = 'F4F6F9';
const GREEN = '27AE60';
const RED   = 'C0392B';
const WHITE = 'FFFFFF';

// ─── STYLE HELPERS ────────────────────────────────────────────
const border = (color = 'CCCCCC') => ({ style: BorderStyle.SINGLE, size: 1, color });
const allBorders = (color = 'CCCCCC') => ({ top: border(color), bottom: border(color), left: border(color), right: border(color) });

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { before: 0, after: 240 },
    children: [new TextRun({ text, bold: true, size: 36, color: WHITE, font: 'Arial' })],
    shading: { fill: BLUE, type: ShadingType.CLEAR },
    indent: { left: 200, right: 200 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 28, color: BLUE, font: 'Arial' })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, color: '2C3E50', font: 'Arial' })],
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, size: 22, font: 'Arial', ...opts })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 22, font: 'Arial' })],
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'numbers', level },
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 22, font: 'Arial' })],
  });
}

function code(text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    indent: { left: 360 },
    shading: { fill: '1E1E1E', type: ShadingType.CLEAR },
    children: [new TextRun({ text, size: 18, font: 'Courier New', color: '00FF88' })],
  });
}

function note(text) {
  return new Paragraph({
    spacing: { before: 100, after: 100 },
    indent: { left: 200, right: 200 },
    shading: { fill: AMBER, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: AMBRB, space: 6 } },
    children: [new TextRun({ text: '⚠  ' + text, size: 20, font: 'Arial', color: '7D4E00' })],
  });
}

function infoBox(text) {
  return new Paragraph({
    spacing: { before: 100, after: 100 },
    indent: { left: 200, right: 200 },
    shading: { fill: 'D6EAF8', type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: '2E86C1', space: 6 } },
    children: [new TextRun({ text: 'ℹ  ' + text, size: 20, font: 'Arial', color: '1A5276' })],
  });
}

function successBox(text) {
  return new Paragraph({
    spacing: { before: 100, after: 100 },
    indent: { left: 200, right: 200 },
    shading: { fill: 'D5F5E3', type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 6 } },
    children: [new TextRun({ text: '✓  ' + text, size: 20, font: 'Arial', color: '1E8449' })],
  });
}

function sep() {
  return new Paragraph({ spacing: { before: 60, after: 60 }, children: [] });
}

function keyValueTable(rows) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2800, CONTENT_W - 2800],
    rows: rows.map(([k, v], i) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2800, type: WidthType.DXA },
            borders: allBorders(),
            shading: { fill: i % 2 === 0 ? GREYB : WHITE, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 20, font: 'Arial' })] })],
          }),
          new TableCell({
            width: { size: CONTENT_W - 2800, type: WidthType.DXA },
            borders: allBorders(),
            shading: { fill: i % 2 === 0 ? GREYB : WHITE, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: v, size: 20, font: 'Courier New' })] })],
          }),
        ],
      })
    ),
  });
}

// ─── DOCUMENT ASSEMBLY ─────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      { reference: 'bullets', levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
        ]},
      { reference: 'numbers', levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
        ]},
    ],
  },
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 36, bold: true, font: 'Arial', color: WHITE },
        paragraph: { spacing: { before: 0, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 28, bold: true, font: 'Arial', color: BLUE },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 24, bold: true, font: 'Arial', color: '2C3E50' },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 4 } },
            children: [new TextRun({ text: 'CyberTowers Vehicle Access Dashboard — Setup Guide', size: 18, color: BLUE, font: 'Arial' })],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 4 } },
            children: [
              new TextRun({ text: 'Page ', size: 18, font: 'Arial', color: '666666' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, font: 'Arial', color: '666666' }),
              new TextRun({ text: ' of ', size: 18, font: 'Arial', color: '666666' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, font: 'Arial', color: '666666' }),
              new TextRun({ text: '   |   Bluesprings AI — Confidential', size: 18, font: 'Arial', color: '666666' }),
            ],
          }),
        ],
      }),
    },
    children: [

      // ══════════════════════════════════════════════════════
      // COVER PAGE
      // ══════════════════════════════════════════════════════
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1440, after: 400 },
        shading: { fill: BLUE, type: ShadingType.CLEAR },
        children: [new TextRun({ text: 'CyberTowers Vehicle Access Dashboard', bold: true, size: 52, color: WHITE, font: 'Arial' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 },
        shading: { fill: BLUE, type: ShadingType.CLEAR },
        children: [new TextRun({ text: 'Complete Setup & Integration Guide', size: 36, color: 'AED6F1', font: 'Arial' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 },
        children: [new TextRun({ text: 'Version 2.0  ·  June 2026  ·  Bluesprings AI', size: 22, color: '666666', font: 'Arial' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 800 },
        children: [new TextRun({ text: 'Covers: Web Application · Bridge Service · Temporal Workflows · PostgreSQL Database', size: 20, color: '888888', font: 'Arial' })] }),
      new Paragraph({ children: [new PageBreak()] }),

      // ══════════════════════════════════════════════════════
      // SECTION 1 — SYSTEM OVERVIEW
      // ══════════════════════════════════════════════════════
      h1('1.  System Overview'),
      p('The CyberTowers Vehicle Access Dashboard is a full-stack system that controls and monitors vehicle entry/exit at the Cyber Towers premises. It consists of five interconnected components:'),
      sep(),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [2200, 2400, CONTENT_W - 4600],
        rows: [
          new TableRow({
            tableHeader: true,
            children: ['Component', 'Technology', 'Purpose'].map(t =>
              new TableCell({
                borders: allBorders(BLUE),
                shading: { fill: BLUE, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20, font: 'Arial', color: WHITE })] })],
              })
            ),
          }),
          ...([
            ['Backend API',    'Node.js + Express', 'REST API on port 5000. Manages cards, controllers, scan events, access groups.'],
            ['Frontend UI',    'React + Vite',      'Dashboard on port 5173. Live monitoring, configuration, reports.'],
            ['Bridge Service', 'C# .NET 8 (x86)',   'Windows service that talks to FC8900 controllers via FCardCDrive.dll SDK.'],
            ['Temporal Worker','Node.js TypeScript', 'Durable workflow engine. Handles entry logic, quota, security approval, alerts, reports.'],
            ['PostgreSQL DB',  'PostgreSQL 15+',     'Primary database: cybertowers_access (schema: cybertowers). All data stored here.'],
          ].map(([comp, tech, purpose], i) =>
            new TableRow({
              children: [comp, tech, purpose].map((t, ci) =>
                new TableCell({
                  borders: allBorders(),
                  shading: { fill: i % 2 === 0 ? GREYB : WHITE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: t, size: 20, font: ci === 0 ? 'Arial' : 'Arial', bold: ci === 0 })] })],
                })
              ),
            })
          )),
        ],
      }),
      sep(),
      h3('How They Connect'),
      bullet('Browser → Frontend (port 5173) → Backend API (port 5000)'),
      bullet('Bridge Service → Backend API POST /internal/bridge/events  (scan events + heartbeats)'),
      bullet('Backend API → Temporal Server (port 7233) — triggers WF1 on every approved entry'),
      bullet('Temporal Worker → PostgreSQL — reads cards, writes audit log, slot counters'),
      bullet('Temporal Worker → Email (SMTP) — sends daily + weekly reports'),

      // ══════════════════════════════════════════════════════
      // SECTION 2 — SOFTWARE TO INSTALL
      // ══════════════════════════════════════════════════════
      h1('2.  Software to Install (One-Time)'),
      p('Install all of the following before running any commands.'),
      sep(),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [2800, 2000, CONTENT_W - 4800],
        rows: [
          new TableRow({ tableHeader: true,
            children: ['Software', 'Version', 'Download / Notes'].map(t =>
              new TableCell({
                borders: allBorders(BLUE), shading: { fill: BLUE, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20, color: WHITE, font: 'Arial' })] })],
              })
            ),
          }),
          ...([
            ['Node.js', '20 LTS', 'https://nodejs.org — tick "Add to PATH" during install'],
            ['Git', 'Latest', 'https://git-scm.com — tick "Use Git from command line"'],
            ['PostgreSQL', '15 or 16', 'https://postgresql.org/download/windows — remember the postgres password you set'],
            ['.NET 8 SDK (x86)', '8.x', 'https://dotnet.microsoft.com/download — needed to run the Bridge'],
            ['Temporal CLI', 'Latest', 'https://github.com/temporalio/cli/releases — download temporal.exe, add to PATH'],
            ['VS Code (optional)', 'Latest', 'For editing config files and viewing logs'],
          ].map(([s, v, n], i) =>
            new TableRow({
              children: [s, v, n].map(t =>
                new TableCell({
                  borders: allBorders(), shading: { fill: i % 2 === 0 ? GREYB : WHITE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: t, size: 20, font: 'Arial' })] })],
                })
              ),
            })
          )),
        ],
      }),
      sep(),
      note('The Bridge Service uses FCardCDrive.dll which is a 32-bit COM library. The Bridge MUST run as x86 (32-bit). Do NOT build it as x64.'),
      note('Temporal CLI installs temporal.exe — this IS the Temporal Server for development. You do not need Docker.'),

      // ══════════════════════════════════════════════════════
      // SECTION 3 — CLONE THE REPOSITORY
      // ══════════════════════════════════════════════════════
      h1('3.  Clone the Web Application'),
      p('Open PowerShell or Command Prompt and run:'),
      code('cd C:\\'),
      code('git clone https://github.com/YOUR_ORG/vehicle-access-dashboard.git'),
      code('cd vehicle-access-dashboard'),
      sep(),
      p('Replace the URL above with your actual GitHub repository URL. The folder structure after cloning:'),
      bullet('backend/         — Node.js API server'),
      bullet('frontend/        — React + Vite web UI'),
      bullet('temporal/        — Temporal workflows + worker'),
      bullet('backend/database/migrations/  — SQL migration scripts'),

      // ══════════════════════════════════════════════════════
      // SECTION 4 — DATABASE SETUP
      // ══════════════════════════════════════════════════════
      h1('4.  PostgreSQL Database Setup'),
      h2('4.1  Create the Database and Schema'),
      p('Open pgAdmin or psql and run the following SQL. The password CyberTowers@2026 must be used everywhere:'),
      code('psql -U postgres -h 127.0.0.1'),
      code('-- Inside psql:'),
      code("CREATE DATABASE cybertowers_access;"),
      code("\\c cybertowers_access"),
      code("CREATE SCHEMA IF NOT EXISTS cybertowers;"),
      code("\\q"),
      sep(),
      note('Always connect using 127.0.0.1 (not localhost). This avoids an IPv6 resolution bug in the x86 Npgsql driver used by the Bridge.'),

      h2('4.2  Run Migrations'),
      p('From inside the vehicle-access-dashboard folder:'),
      code('cd backend'),
      code('npm install'),
      code('npm run migrate'),
      sep(),
      p('Expected output:'),
      code('Migrations: 5 total · 0 applied · 5 pending'),
      code('▶ applied 001_cards_assigned_user.sql'),
      code('▶ applied 002_cards_push_tracking.sql'),
      code('▶ applied 003_cards_blood_group.sql'),
      code('▶ applied 004_company_slots.sql'),
      code('▶ applied 005_temporal_audit_log.sql'),
      code('✅ Applied 5 migration(s).'),
      sep(),
      successBox('Migration 004 creates the company_slots table used by Temporal workflows to track parking quota. Migration 005 creates the temporal_audit_log table for durable event history.'),

      // ══════════════════════════════════════════════════════
      // SECTION 5 — BACKEND CONFIGURATION
      // ══════════════════════════════════════════════════════
      h1('5.  Backend Configuration'),
      h2('5.1  Create backend/.env'),
      p('Create a file named .env inside the backend/ folder with this exact content:'),
      code('# PostgreSQL'),
      code('PG_HOST=127.0.0.1'),
      code('PG_PORT=5432'),
      code('PG_DATABASE=cybertowers_access'),
      code('PG_USER=postgres'),
      code('PG_PASSWORD=CyberTowers@2026'),
      code('PG_SCHEMA=cybertowers'),
      sep(),
      code('# Server'),
      code('PORT=5000'),
      code('NODE_ENV=production'),
      sep(),
      code('# Bridge API Key — must match appsettings.json'),
      code('API_KEY=37e70f1f870f21bb4f32d1848e66a5555adc8df58f7b4029eb0091d0289fad30'),
      sep(),
      code('# Temporal'),
      code('TEMPORAL_ADDRESS=localhost:7233'),
      sep(),
      code('# Email Reports (optional — WF4 Daily, WF5 Weekly)'),
      code('EMAIL_HOST=smtp.gmail.com'),
      code('EMAIL_PORT=587'),
      code('EMAIL_USER=your-gmail@gmail.com'),
      code('EMAIL_PASS=YOUR_APP_PASSWORD_HERE'),
      code('ADMIN_EMAIL=admin@yourdomain.com'),
      sep(),
      note('Never commit backend/.env to Git. It is already in .gitignore.'),
      note('EMAIL_PASS must be a Gmail App Password (not your account password). Generate one at: Google Account → Security → 2-Step Verification → App Passwords.'),

      h2('5.2  Start the Backend'),
      code('cd backend'),
      code('npm install'),
      code('npm start'),
      sep(),
      p('You should see:'),
      code('[DB] PostgreSQL connected — cybertowers_access'),
      code('Backend server running on http://localhost:5000'),

      // ══════════════════════════════════════════════════════
      // SECTION 6 — FRONTEND CONFIGURATION
      // ══════════════════════════════════════════════════════
      h1('6.  Frontend Configuration'),
      h2('6.1  Create frontend/.env'),
      code('VITE_API_BASE_URL=http://localhost:5000'),
      code('VITE_WS_URL=ws://localhost:5000'),
      sep(),
      note('For production deployment, replace localhost with your server\'s IP address or domain name.'),

      h2('6.2  Build and Start Frontend'),
      code('cd frontend'),
      code('npm install'),
      code('npm run dev'),
      sep(),
      p('For production:'),
      code('npm run build'),
      code('npm run preview'),
      sep(),
      p('Open http://localhost:5173 in your browser. You should see the CyberTowers dashboard.'),

      // ══════════════════════════════════════════════════════
      // SECTION 7 — TEMPORAL WORKFLOWS
      // ══════════════════════════════════════════════════════
      h1('7.  Temporal Workflows'),
      infoBox('Temporal provides durable, crash-safe workflow execution. Even if the server restarts, workflows resume exactly where they left off. This is used for vehicle entry logic, security approval, quota management, and automated reports.'),
      sep(),

      h2('7.1  What the Workflows Do'),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [1200, 2400, CONTENT_W - 3600],
        rows: [
          new TableRow({ tableHeader: true,
            children: ['ID', 'Trigger', 'What It Does'].map(t =>
              new TableCell({
                borders: allBorders(BLUE), shading: { fill: BLUE, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20, color: WHITE, font: 'Arial' })] })],
              })
            ),
          }),
          ...([
            ['WF1', 'Every approved card scan', 'Main entry/exit logic — quota check, LED signal, slot count'],
            ['WF2', 'Started by WF1 on entry',  'Overstay alert — emails at 24h, 32h, 40h if vehicle still inside'],
            ['WF3', 'WF1 (unauthorized card)',   'Security approval flow — waits for security officer decision'],
            ['WF4', 'Daily schedule (11:59 PM)', 'Sends daily access report email to ADMIN_EMAIL'],
            ['WF5', 'Weekly (Monday 8 AM)',       'Sends weekly analytics email with company breakdown'],
            ['WF8/WF9', 'WF1 (quota full)',       'Admin quota-override flow — security requests, admin approves/denies'],
          ].map(([id, trig, desc], i) =>
            new TableRow({
              children: [id, trig, desc].map(t =>
                new TableCell({
                  borders: allBorders(), shading: { fill: i % 2 === 0 ? GREYB : WHITE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: t, size: 20, font: 'Arial', bold: t === id })] })],
                })
              ),
            })
          )),
        ],
      }),

      h2('7.2  Install Temporal CLI (Server)'),
      p('Download temporal.exe from:'),
      p('https://github.com/temporalio/cli/releases  →  find temporal_cli_windows_amd64.zip'),
      numbered('Extract temporal.exe to C:\\temporal\\'),
      numbered('Add C:\\temporal\\ to your Windows PATH:'),
      bullet('Search "Environment Variables" → Edit System Variables → Path → New → C:\\temporal\\', 1),
      numbered('Verify in a new PowerShell window:'),
      code('temporal --version'),
      sep(),
      p('Expected: temporal version 1.x.x'),

      h2('7.3  Start Temporal Server'),
      p('Open a dedicated PowerShell window and run:'),
      code('temporal server start-dev --db-filename C:\\temporal\\temporal.db'),
      sep(),
      p('Expected output:'),
      code('Temporal server listening on: 0.0.0.0:7233'),
      code('Temporal UI available: http://localhost:8233'),
      sep(),
      infoBox('Keep this window open. The Temporal Server must be running before starting the Temporal Worker. The --db-filename flag persists workflow state across restarts.'),

      h2('7.4  Install Temporal Worker Dependencies'),
      code('cd temporal'),
      code('npm install'),
      sep(),
      p('This installs: @temporalio/* packages, pg (PostgreSQL driver), nodemailer, dotenv, TypeScript, ts-node.'),

      h2('7.5  Start the Temporal Worker'),
      p('Open another PowerShell window:'),
      code('cd temporal'),
      code('npm run worker:dev'),
      sep(),
      p('Expected output:'),
      code('[Worker] Starting on task queue: cyber-towers-task-queue'),
      code('[DB] PG pool ready — cybertowers_access'),
      code('[Worker] Registered workflows: wf1EntryExit, wf2OverstayAlert, wf3SecurityApproval ...'),
      sep(),
      note('The Temporal Worker reads the backend .env file for database credentials. Ensure backend/.env exists before starting the worker.'),
      note('For production use, build first with  npm run build  then start with  npm run worker  (uses compiled JS instead of ts-node).'),

      h2('7.6  Set Up Scheduled Reports (Run Once)'),
      p('After starting the Temporal Server and Worker, run these commands ONCE to create the schedules:'),
      code('cd temporal'),
      code('npm run create-schedule          # creates daily report at 11:59 PM IST'),
      code('npm run create-weekly-schedule   # creates weekly report on Mondays at 8 AM IST'),
      sep(),
      p('Verify schedules were created:'),
      code('temporal schedule list --namespace default'),
      sep(),
      infoBox('Schedules persist in the Temporal database (temporal.db). You only need to run these commands once. The reports fire automatically every day/week thereafter.'),

      h2('7.7  Trigger Reports Manually (for Testing)'),
      code('npm run trigger-daily-now    # send today\'s daily report immediately'),
      code('npm run trigger-weekly-now   # send this week\'s weekly report immediately'),

      h2('7.8  View Temporal Web UI'),
      p('Open http://localhost:8233 in your browser. You can see:'),
      bullet('All running and completed workflows'),
      bullet('Workflow history and event timeline'),
      bullet('Signal inputs (security decisions, exit signals)'),
      bullet('Activity results and retry counts'),

      // ══════════════════════════════════════════════════════
      // SECTION 8 — BRIDGE SERVICE
      // ══════════════════════════════════════════════════════
      h1('8.  Bridge Service (FC8900 Controller Integration)'),
      infoBox('The Bridge is a separate C# Windows application. It is NOT part of the web app repository. It runs alongside the web app and connects the physical FC8900 access controllers to the PostgreSQL database.'),

      h2('8.1  Bridge Folder Structure'),
      p('Place the Bridge files in this exact folder:'),
      code('E:\\CyberTowers.Bridge\\'),
      sep(),
      bullet('CyberTowers.Bridge.exe         — main executable (x86)'),
      bullet('FCardCDrive.dll                — FC8900 SDK (32-bit, must be x86)'),
      bullet('appsettings.json               — all configuration here'),
      bullet('appsettings.Development.json   — overrides for dev (optional)'),
      bullet('Logs\\                          — auto-created, rolling log files'),

      h2('8.2  appsettings.json'),
      p('Create or edit E:\\CyberTowers.Bridge\\appsettings.json with this exact content:'),
      code('{'),
      code('  "Bridge": {'),
      code('    "BackendBaseUrl": "http://127.0.0.1:5000",'),
      code('    "BackendApiKey":  "37e70f1f870f21bb4f32d1848e66a5555adc8df58f7b4029eb0091d0289fad30",'),
      code('    "PollIntervalSeconds": 15,'),
      code('    "HeartbeatIntervalSeconds": 30'),
      code('  },'),
      code('  "Database": {'),
      code('    "ConnectionString": "Host=127.0.0.1;Port=5432;Database=cybertowers_access;Username=postgres;Password=CyberTowers@2026"'),
      code('  },'),
      code('  "Logging": {'),
      code('    "LogLevel": { "Default": "Information" }'),
      code('  }'),
      code('}'),
      sep(),
      note('CRITICAL: The Database ConnectionString MUST use Host=127.0.0.1 (not Host=localhost). Using localhost causes a crash in the 32-bit Npgsql driver on Windows due to IPv6 DNS resolution.'),
      note('The BackendApiKey must exactly match the API_KEY value in backend/.env.'),

      h2('8.3  Run the Bridge'),
      p('Open a new PowerShell window (as Administrator if needed):'),
      code('cd E:\\CyberTowers.Bridge'),
      code('.\\CyberTowers.Bridge.exe'),
      sep(),
      p('Expected output:'),
      code('[Bridge] Connected to PostgreSQL'),
      code('[Bridge] Backend reachable at http://127.0.0.1:5000'),
      code('[Bridge] Polling for controllers...'),
      sep(),
      p('The Bridge will then connect to any FC8900 controllers listed in the database and start:'),
      bullet('Sending live scan events to POST /internal/bridge/events'),
      bullet('Polling for card push jobs every 15 seconds'),
      bullet('Sending heartbeats to PATCH /internal/bridge/controller-status'),

      h2('8.4  Add a Controller'),
      numbered('Open the Dashboard → Configuration → Controllers tab'),
      numbered('Click "Add Controller"'),
      numbered('Enter the controller IP address, port (default 8000), and serial number'),
      numbered('Click Save — the Bridge will connect within 30 seconds'),

      // ══════════════════════════════════════════════════════
      // SECTION 9 — REGISTER CARDS
      // ══════════════════════════════════════════════════════
      h1('9.  Register Cards and Tags'),
      h2('9.1  Register an RFID Card'),
      numbered('Dashboard → Configuration → Cards tab → Add Card'),
      numbered('Fill in: Card Number, Person Name, Company Code, Card Type'),
      numbered('Card Types: Vehicle, Visitor, Staff, Monthly'),
      numbered('Click Save'),
      sep(),
      note('After saving, the card appears with push_status = Pending. You must push it to the controller before it can grant access.'),

      h2('9.2  Push a Card to the Controller'),
      p('Once a card is registered, push it to the physical controller:'),
      numbered('Find the card in the Cards tab — it shows a green "Push" button'),
      numbered('Click "Push"'),
      numbered('If the controller is online: the card is queued and written within 15 seconds'),
      numbered('If the controller is offline: the card is queued and will auto-push when it reconnects'),
      sep(),
      infoBox('The card push_status changes from Pending → Synced once the Bridge confirms the write. You can see the status update live on the dashboard.'),

      // ══════════════════════════════════════════════════════
      // SECTION 10 — COMPLETE STARTUP CHECKLIST
      // ══════════════════════════════════════════════════════
      h1('10.  Complete Daily Startup Checklist'),
      p('Start components in this exact order every time:'),
      sep(),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [600, 2800, CONTENT_W - 3400],
        rows: [
          new TableRow({ tableHeader: true,
            children: ['#', 'Component', 'Command / Action'].map(t =>
              new TableCell({
                borders: allBorders(BLUE), shading: { fill: BLUE, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20, color: WHITE, font: 'Arial' })] })],
              })
            ),
          }),
          ...([
            ['1', 'PostgreSQL',       'Must already be running (auto-starts with Windows after install)'],
            ['2', 'Temporal Server',  'temporal server start-dev --db-filename C:\\temporal\\temporal.db'],
            ['3', 'Backend API',      'cd backend  →  npm start'],
            ['4', 'Temporal Worker',  'cd temporal →  npm run worker:dev'],
            ['5', 'Frontend',         'cd frontend →  npm run dev'],
            ['6', 'Bridge Service',   'cd E:\\CyberTowers.Bridge  →  .\\CyberTowers.Bridge.exe'],
          ].map(([n, comp, cmd], i) =>
            new TableRow({
              children: [[n, 600], [comp, 2800], [cmd, CONTENT_W - 3400]].map(([t, w]) =>
                new TableCell({
                  width: { size: w, type: WidthType.DXA },
                  borders: allBorders(), shading: { fill: i % 2 === 0 ? GREYB : WHITE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: String(t), size: 20, font: 'Courier New' })] })],
                })
              ),
            })
          )),
        ],
      }),
      sep(),
      note('Steps 2–6 each require a separate PowerShell window. Keep all 5 windows open while the system is running.'),

      // ══════════════════════════════════════════════════════
      // SECTION 11 — AUTO-START ON WINDOWS
      // ══════════════════════════════════════════════════════
      h1('11.  Auto-Start on Windows Boot'),
      p('To start everything automatically when Windows boots, create startup scripts.'),
      sep(),
      h2('11.1  Create a Startup Script'),
      p('Save the following as C:\\CyberTowers\\start-all.bat:'),
      code('@echo off'),
      code('start "Temporal Server" cmd /k "temporal server start-dev --db-filename C:\\temporal\\temporal.db"'),
      code('timeout /t 5'),
      code('start "Backend" cmd /k "cd /d E:\\vehicle-access-dashboard\\backend && npm start"'),
      code('timeout /t 3'),
      code('start "Temporal Worker" cmd /k "cd /d E:\\vehicle-access-dashboard\\temporal && npm run worker:dev"'),
      code('timeout /t 3'),
      code('start "Frontend" cmd /k "cd /d E:\\vehicle-access-dashboard\\frontend && npm run dev"'),
      code('timeout /t 3'),
      code('start "Bridge" cmd /k "cd /d E:\\CyberTowers.Bridge && CyberTowers.Bridge.exe"'),
      sep(),
      h2('11.2  Add to Windows Startup'),
      numbered('Press Win + R → type  shell:startup  → Enter'),
      numbered('Create a shortcut to C:\\CyberTowers\\start-all.bat in that folder'),
      numbered('All components will auto-start on next Windows login'),

      // ══════════════════════════════════════════════════════
      // SECTION 12 — TECHNICAL REFERENCE
      // ══════════════════════════════════════════════════════
      h1('12.  Technical Reference'),
      h2('12.1  Port Reference'),
      keyValueTable([
        ['PostgreSQL',      '5432'],
        ['Backend API',     '5000'],
        ['Frontend (dev)',  '5173'],
        ['Temporal Server', '7233'],
        ['Temporal Web UI', '8233'],
        ['FC8900 Controller', '8000 (TCP) + 8101 (UDP)'],
      ]),
      sep(),
      h2('12.2  Key Database Tables'),
      keyValueTable([
        ['cybertowers.cards',              'RFID cards — person info, push status'],
        ['cybertowers.controllers',        'FC8900 controller list'],
        ['cybertowers.scan_events',        'Every entry/exit scan from the bridge'],
        ['cybertowers.card_push_log',      'Queue of card push jobs for the bridge'],
        ['cybertowers.company_slots',      'Per-company parking slot counters (Temporal)'],
        ['cybertowers.temporal_audit_log', 'Durable audit trail of workflow decisions'],
        ['cybertowers.alerts',             'Security alerts from controllers'],
      ]),
      sep(),
      h2('12.3  Temporal Task Queue'),
      keyValueTable([
        ['Task Queue Name', 'cyber-towers-task-queue'],
        ['Namespace',       'default'],
        ['Server Address',  'localhost:7233'],
        ['DB File',         'C:\\temporal\\temporal.db'],
      ]),
      sep(),
      h2('12.4  Important File Locations'),
      keyValueTable([
        ['Web App Root',    'E:\\vehicle-access-dashboard\\'],
        ['Backend .env',    'E:\\vehicle-access-dashboard\\backend\\.env'],
        ['Frontend .env',   'E:\\vehicle-access-dashboard\\frontend\\.env'],
        ['Bridge Folder',   'E:\\CyberTowers.Bridge\\'],
        ['Bridge Config',   'E:\\CyberTowers.Bridge\\appsettings.json'],
        ['Bridge Logs',     'E:\\CyberTowers.Bridge\\Logs\\'],
        ['Temporal DB',     'C:\\temporal\\temporal.db'],
        ['Temporal Web UI', 'http://localhost:8233'],
      ]),

      // ══════════════════════════════════════════════════════
      // SECTION 13 — TROUBLESHOOTING
      // ══════════════════════════════════════════════════════
      h1('13.  Troubleshooting'),
      h2('13.1  Common Issues'),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [3000, CONTENT_W - 3000],
        rows: [
          new TableRow({ tableHeader: true,
            children: ['Problem', 'Fix'].map(t =>
              new TableCell({
                borders: allBorders(BLUE), shading: { fill: BLUE, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20, color: WHITE, font: 'Arial' })] })],
              })
            ),
          }),
          ...([
            ['Bridge crashes on start',           'Check that Host=127.0.0.1 in ConnectionString (not localhost). Check FCardCDrive.dll is in the same folder as the exe.'],
            ['Backend: Cannot connect to PG',     'Verify PG_PASSWORD in backend/.env matches PostgreSQL. Ensure PostgreSQL service is running.'],
            ['Temporal: connection refused 7233',  'Start Temporal Server first: temporal server start-dev --db-filename C:\\temporal\\temporal.db'],
            ['Worker: WF1 not triggering',         'Check temporal/lib/client.js exists (run npm run build in temporal/). Restart backend after build.'],
            ['Cards not syncing to controller',    'Check Bridge is running. Check controller is Online in Configuration. Click Push on the card.'],
            ['Email reports not sending',          'Set EMAIL_USER, EMAIL_PASS (App Password), ADMIN_EMAIL in backend/.env. Restart backend and worker.'],
            ['Frontend: blank page or 404',        'Run npm run dev in frontend/ and check VITE_API_BASE_URL in frontend/.env points to port 5000.'],
          ].map(([prob, fix], i) =>
            new TableRow({
              children: [prob, fix].map(t =>
                new TableCell({
                  borders: allBorders(), shading: { fill: i % 2 === 0 ? GREYB : WHITE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: t, size: 20, font: 'Arial' })] })],
                })
              ),
            })
          )),
        ],
      }),

      h2('13.2  Verify Everything is Working'),
      numbered('Backend health:  open http://localhost:5000/health in browser → should return { "ok": true }'),
      numbered('Frontend:        open http://localhost:5173 → dashboard loads with live data'),
      numbered('Temporal UI:     open http://localhost:8233 → shows workflows and schedules'),
      numbered('Bridge:          open Configuration → Controllers → status shows Online'),
      numbered('Card push:       register a card, click Push → status changes to Synced within 15s'),

      sep(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 200 },
        children: [new TextRun({ text: 'End of Document', size: 20, color: '888888', font: 'Arial', italics: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'CyberTowers Vehicle Access Dashboard — Bluesprings AI — Confidential', size: 18, color: 'AAAAAA', font: 'Arial' })],
      }),
    ],
  }],
});

const outPath = path.join(__dirname, 'CyberTowers_Setup_Guide_v2.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log(`✅ Document written: ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
