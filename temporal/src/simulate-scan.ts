// ═══════════════════════════════════════════════════════════════
//  SIMULATE-SCAN.TS — RFID Tag Simulator for Testing Temporal Workflows
// ═══════════════════════════════════════════════════════════════
//
//  PURPOSE:
//    You don't have physical RFID tags or a UHF reader right now.
//    This script replaces the hardware — it pretends to be a vehicle
//    scanning at the gate and sends the same data that the real reader
//    would send, directly into Temporal to trigger the workflows.
//
//  HOW TO RUN:
//    cd temporal
//    npm run simulate
//
//  WHAT YOU'LL SEE:
//    A menu appears in the terminal. Pick a scenario (1, 2, 3...).
//    The script shows exactly what data it is "sending" (dummy scan data).
//    Then it triggers the Temporal workflow.
//    You can watch the workflow run at: http://localhost:8233
//
//  REQUIREMENTS BEFORE RUNNING:
//    1. Temporal Server must be running    (temporal server start-dev)
//    2. Your Temporal Worker must be running  (npm run worker:dev)
//    3. Your Express backend should ideally be running too (port 5000)
//       (gate commands + WebSocket broadcasts will fail silently if not)
//
// ═══════════════════════════════════════════════════════════════

import * as readline from 'readline';
import * as path     from 'path';
import * as dotenv   from 'dotenv';

// Load .env from backend folder (same as all other temporal files)
dotenv.config({ path: path.join(__dirname, '../../backend/.env') });

// Import all the client functions we built in client.ts
import {
  triggerWF1,
  sendExitSignal,
  sendSecurityDecision,
  sendOverrideRequest,
  sendAdminDecision,
  childWf3Id,
  childWf9Id,
} from './client';

// ─── TERMINAL COLOURS ────────────────────────────────────────
// ANSI escape codes — built into every terminal.
// \x1b[ = start of escape sequence
// [0m = reset, [32m = green, [33m = yellow, etc.
// We use these to make the output easy to read.
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  blue:   '\x1b[34m',
  white:  '\x1b[37m',
};

// Helpers — wraps text in a colour and then resets
const green  = (s: string) => `${C.green}${s}${C.reset}`;
const yellow = (s: string) => `${C.yellow}${s}${C.reset}`;
const cyan   = (s: string) => `${C.cyan}${s}${C.reset}`;
const red    = (s: string) => `${C.red}${s}${C.reset}`;
const bold   = (s: string) => `${C.bold}${s}${C.reset}`;
const dim    = (s: string) => `${C.dim}${s}${C.reset}`;

// ─── DUMMY CARDS ─────────────────────────────────────────────
//
//  These represent RFID cards employees carry.
//  The cardId is what the UHF reader would read from the tag.
//
//  IMPORTANT: lookupPersonnel() in db.activities.ts queries the
//  REAL TimeWatch database for this cardId.
//
//  - If the cardId EXISTS in your CardRecord table → AUTHORIZED path (WF1)
//  - If the cardId DOES NOT EXIST → UNAUTHORIZED path (WF3)
//
//  HOW TO SET UP YOUR OWN REAL CARD IDs:
//    Open your TimeWatch database → CardRecord table.
//    Find some real card IDs (the CardData or CardNum column).
//    Replace "REPLACE_WITH_REAL_CARD_ID" below with those values.
//    Then scenario 1 and 2 will test the authorized entry path.
//
//  For now, the fake IDs below will trigger the UNAUTHORIZED path (WF3)
//  unless you replace them with real values.
//
const DUMMY_CARDS = [
  {
    label:         'Employee A — Pavan Kumar (MSFT)',
    cardId:        '5248273',   // ← put real TimeWatch cardId here
    vehicleNumber: 'TS 09 AB 1234',
    gate:          'GATE_1',
  },
  {
    label:         'Employee B — Ravi Teja (INFY)',
    cardId:        '5248274', // ← put real TimeWatch cardId here
    vehicleNumber: 'TS 13 CD 5678',
    gate:          'GATE_1',
  },
  {
    label:         'FAKE card — not in DB (triggers WF3 Unauthorized)',
    cardId:        'FAKE_CARD_TEST_001',           // this will never be in TimeWatch DB
    vehicleNumber: 'AP 28 ZZ 0000',
    gate:          'GATE_1',
  },
];

// ─── STATE — tracks the last started workflow IDs ─────────────
//
//  Three separate IDs because each signal type must go to a DIFFERENT workflow:
//
//    lastWF1Id   → WF1 workflow ID  → used for the EXIT signal (option 6)
//    lastWF3Id   → WF3 workflow ID  → used for SECURITY DECISION signals (options 7 / 8)
//    lastWF9Id   → WF9 workflow ID  → used for OVERRIDE signals (options 9 / a / b)
//
//  WF3 and WF9 run as CHILD workflows inside WF1. Sending a signal to WF1's
//  ID for those operations would do nothing — WF1 only listens for exitSignal.
//  WF3 listens for securityDecisionSignal; WF9 listens for overrideRequestSignal /
//  adminDecisionSignal. We compute their IDs deterministically from cardId +
//  timestamp (same formula used in wf1-entry-exit.ts executeChild calls).
//
let lastWF1Id: string | null = null;
let lastWF3Id: string | null = null;
let lastWF9Id: string | null = null;

// ─── HELPER: build a timestamp ───────────────────────────────
// Returns current time as ISO string: "2026-06-09T14:30:00.000Z"
// This simulates the timestamp the real UHF reader would send.
function now(): string {
  return new Date().toISOString();
}

// ─── HELPER: print a "scan data" table ───────────────────────
// Shows the exact data being sent so you understand what a real scan looks like.
function printScanData(cardId: string, vehicleNumber: string, gate: string, portNum: number, timestamp: string): void {
  const portLabel = portNum === 1 ? 'ENTRY (vehicle entering)' : 'EXIT  (vehicle leaving)';
  console.log('');
  console.log(cyan('  ┌─────────────────────────────────────────────┐'));
  console.log(cyan('  │           SIMULATED RFID SCAN DATA           │'));
  console.log(cyan('  └─────────────────────────────────────────────┘'));
  console.log(`  ${bold('Card ID')}       : ${yellow(cardId)}`);
  console.log(`  ${bold('Vehicle No.')}   : ${yellow(vehicleNumber)}`);
  console.log(`  ${bold('Gate')}          : ${yellow(gate)}`);
  console.log(`  ${bold('Port')}          : ${yellow(String(portNum))}  ← ${dim(portLabel)}`);
  console.log(`  ${bold('Timestamp')}     : ${yellow(timestamp)}`);
  console.log('');
  console.log(dim('  This is the same data structure a real UHF reader sends.'));
  console.log('');
}

// ─── HELPER: print workflow result ───────────────────────────
function printResult(workflowId: string, label: string): void {
  console.log(green(`  ✅  ${label}`));
  console.log('');
  console.log(`  ${bold('Workflow ID')}   : ${cyan(workflowId)}`);
  console.log(`  ${bold('Track at')}      : ${cyan(`http://localhost:8233/namespaces/default/workflows/${encodeURIComponent(workflowId)}`)}`);
  console.log('');
  console.log(dim('  You can also see all workflows at: http://localhost:8233'));
  console.log('');
}

// ─── HELPER: print a signal result ───────────────────────────
function printSignalResult(signal: string, targetId: string): void {
  console.log('');
  console.log(green(`  ✅  Signal sent: "${signal}"`));
  console.log(`  ${bold('Sent to')}       : ${cyan(targetId)}`);
  console.log(`  ${bold('Track at')}      : ${cyan(`http://localhost:8233/namespaces/default/workflows/${encodeURIComponent(targetId)}`)}`);
  console.log('');
}

// ─── HELPER: print error ─────────────────────────────────────
function printError(err: any): void {
  console.log('');
  console.log(red(`  ❌  Error: ${err?.message || String(err)}`));
  console.log('');
  console.log(dim('  Common causes:'));
  console.log(dim('    • Temporal Server not running  →  run: temporal server start-dev'));
  console.log(dim('    • Temporal Worker not running  →  run: npm run worker:dev'));
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
//  SCENARIO HANDLERS
// ═══════════════════════════════════════════════════════════════

// ─── SCENARIO 1 + 2 + 3: Trigger a scan ──────────────────────
async function triggerScan(cardIndex: number, autoExit: boolean): Promise<void> {

  const card      = DUMMY_CARDS[cardIndex];
  const timestamp = now();
  const portNum   = 1; // 1 = ENTRY

  console.log('');
  console.log(bold(`  Simulating scan: ${card.label}`));
  printScanData(card.cardId, card.vehicleNumber, card.gate, portNum, timestamp);

  console.log('  Sending to Temporal...');

  try {
    const workflowId = await triggerWF1({
      cardId:        card.cardId,
      vehicleNumber: card.vehicleNumber,
      gate:          card.gate,
      timestamp,
      portNum,
    });

    lastWF1Id = workflowId;
    // Pre-compute child IDs — WF1 uses the same formula in executeChild calls
    lastWF3Id = childWf3Id(card.cardId, timestamp);
    lastWF9Id = childWf9Id(card.cardId, timestamp);
    printResult(workflowId, 'WF1 started!');

    console.log(dim('  What happens next:'));
    if (card.cardId.startsWith('FAKE') || card.cardId.startsWith('REPLACE')) {
      console.log(dim('    → lookupPersonnel will find NO record for this cardId'));
      console.log(dim(`    → WF3 will start  (ID: ${lastWF3Id})`));
      console.log(dim('    → An alert email will be sent to the admin'));
      console.log(dim('    → Use option [7] to APPROVE or [8] to DENY  (signals WF3, not WF1)'));
    } else {
      console.log(dim('    → lookupPersonnel will query TimeWatch DB'));
      console.log(dim('    → If authorized + quota available → gate OPENS (WF7+WF2 start)'));
      console.log(dim(`    → If quota full → WF9 will start  (ID: ${lastWF9Id})`));
      console.log(dim('    → WF1 will now SLEEP waiting for exit signal'));
      if (!autoExit) {
        console.log(dim('    → Use option [6] to send exit signal when ready (signals WF1)'));
      }
    }
    console.log('');

    // Auto-exit: wait 30 seconds then send exit signal
    if (autoExit && !card.cardId.startsWith('FAKE')) {
      console.log(yellow('  ⏳  Auto-exit in 30 seconds... (vehicle enters, then exits)'));
      console.log(yellow('      Watch the workflow in Temporal UI as it processes.'));
      console.log('');

      await sleep(30_000); // 30 seconds

      const exitTimestamp = now();
      const exitGate      = card.gate; // assume same gate for simplicity

      console.log('');
      console.log(bold('  Simulating EXIT scan (vehicle leaving)...'));
      printScanData(card.cardId, card.vehicleNumber, exitGate, 2, exitTimestamp);

      await sendExitSignal(workflowId, { timestamp: exitTimestamp, gate: exitGate });
      printSignalResult('exitSignal', workflowId);

      console.log(dim('  WF1 will now:'));
      console.log(dim('    1. Decrement company slot count'));
      console.log(dim('    2. Signal WF7 → broadcast EXIT to dashboard'));
      console.log(dim('    3. Signal WF2 → cancel overstay monitoring'));
      console.log(dim('    4. Write VEHICLE_EXIT audit log'));
      console.log(dim('    5. Mark workflow COMPLETED'));
      console.log('');
    }

  } catch (err) {
    printError(err);
  }
}

// ─── SCENARIO 4: Send Exit Signal ────────────────────────────
async function doSendExit(rl: readline.Interface): Promise<void> {

  if (!lastWF1Id) {
    console.log('');
    console.log(yellow('  ⚠️   No WF1 workflow started in this session yet.'));
    console.log(yellow('       Enter the WF1 workflow ID manually.'));
    console.log('');
  }

  const defaultId = lastWF1Id ?? '';
  const wfId = await ask(rl, `  WF1 Workflow ID [${dim(defaultId || 'none')}]: `);
  const finalId = wfId.trim() || defaultId;

  if (!finalId) {
    console.log(red('  No workflow ID provided.'));
    return;
  }

  const exitTimestamp = now();

  console.log('');
  console.log(bold('  Simulating EXIT scan (PortNum=2)...'));
  console.log(`  ${bold('Timestamp')} : ${yellow(exitTimestamp)}`);
  console.log(`  ${bold('Gate')}      : ${yellow('GATE_1')}`);
  console.log('');

  try {
    await sendExitSignal(finalId, { timestamp: exitTimestamp, gate: 'GATE_1' });
    printSignalResult('exitSignal', finalId);

    console.log(dim('  WF1 wakes up and will:'));
    console.log(dim('    → Decrement company slot count in DB'));
    console.log(dim('    → Signal WF7 → broadcast EXIT to dashboard'));
    console.log(dim('    → Signal WF2 → cancel overstay alert'));
    console.log(dim('    → Write VEHICLE_EXIT audit log'));
    console.log('');
  } catch (err) {
    printError(err);
  }
}

// ─── SCENARIO 5 + 6: WF3 Security Decision ───────────────────
async function doSecurityDecision(rl: readline.Interface, action: 'approve' | 'deny'): Promise<void> {

  // Signal must go to WF3's ID, not WF1's — WF3 is the one waiting for securityDecisionSignal
  const defaultId = lastWF3Id ?? '';
  const wfId = await ask(rl, `  WF3 Workflow ID [${dim(defaultId || 'none')}]: `);
  const finalId = wfId.trim() || defaultId;

  if (!finalId) { console.log(red('  No workflow ID.')); return; }

  const officerId = await ask(rl, `  Officer ID [default: SEC001]: `);

  console.log('');
  console.log(bold(`  Sending security decision: ${action.toUpperCase()}`));
  console.log(`  ${bold('Sent to')}    : ${cyan(finalId)}`);
  console.log(`  ${bold('Action')}     : ${action === 'approve' ? green('APPROVE') : red('DENY')}`);
  console.log(`  ${bold('Officer')}    : ${yellow(officerId.trim() || 'SEC001')}`);
  console.log('');

  try {
    await sendSecurityDecision(finalId, {
      action,
      officerId: officerId.trim() || 'SEC001',
      reason:    action === 'approve' ? 'Manual override via test script' : 'Test denial',
    });
    printSignalResult('securityDecisionSignal', finalId);

    if (action === 'approve') {
      console.log(dim('  WF3 will now: open gate → send confirmation email → complete'));
    } else {
      console.log(dim('  WF3 will now: write DENIED audit log → complete'));
    }
    console.log('');
  } catch (err) {
    printError(err);
  }
}

// ─── SCENARIO 7: WF9 Override Request ────────────────────────
async function doOverrideRequest(rl: readline.Interface): Promise<void> {

  // Signal must go to WF9's ID — WF9 is the child workflow waiting for overrideRequestSignal
  const defaultId = lastWF9Id ?? '';
  const wfId = await ask(rl, `  WF9 Workflow ID [${dim(defaultId || 'none')}]: `);
  const finalId = wfId.trim() || defaultId;

  if (!finalId) { console.log(red('  No workflow ID.')); return; }

  console.log('');
  console.log(bold('  Sending Override Request Signal to WF9...'));
  console.log(dim('  This simulates the security guard clicking "Request Override" on the dashboard.'));
  console.log('');

  try {
    await sendOverrideRequest(finalId);
    printSignalResult('overrideRequestSignal', finalId);
    console.log(dim('  WF9 will now: send override request email to company admin → wait 5 min for admin decision'));
    console.log(dim('  Use option [8] or [9] to send admin decision.'));
    console.log('');
  } catch (err) {
    printError(err);
  }
}

// ─── SCENARIO 8 + 9: WF9 Admin Decision ──────────────────────
async function doAdminDecision(rl: readline.Interface, action: 'approve' | 'deny'): Promise<void> {

  // Signal must go to WF9's ID — WF9 is the child workflow waiting for adminDecisionSignal
  const defaultId = lastWF9Id ?? '';
  const wfId = await ask(rl, `  WF9 Workflow ID [${dim(defaultId || 'none')}]: `);
  const finalId = wfId.trim() || defaultId;

  if (!finalId) { console.log(red('  No workflow ID.')); return; }

  const adminId = await ask(rl, `  Admin ID [default: ADMIN001]: `);

  console.log('');
  console.log(bold(`  Sending admin decision: ${action.toUpperCase()}`));

  try {
    await sendAdminDecision(finalId, {
      action,
      adminId: adminId.trim() || 'ADMIN001',
      reason:  action === 'approve' ? 'Approved via test script' : 'Denied via test script',
    });
    printSignalResult('adminDecisionSignal', finalId);

    if (action === 'approve') {
      console.log(dim('  WF9 will now: open gate → send approval email → write OVERRIDE_APPROVED → complete'));
    } else {
      console.log(dim('  WF9 will now: send denial email → write OVERRIDE_DENIED → complete'));
    }
    console.log('');
  } catch (err) {
    printError(err);
  }
}

// ─── SCENARIO 10: Custom Card ID ─────────────────────────────
async function doCustomScan(rl: readline.Interface): Promise<void> {

  console.log('');
  console.log(bold('  Enter custom scan data:'));
  console.log(dim('  (Press Enter to use the default value shown in brackets)'));
  console.log('');

  const cardId        = await ask(rl, `  Card ID        [CUSTOM_001]         : `);
  const vehicleNumber = await ask(rl, `  Vehicle Number [TS 09 AB 0000]       : `);
  const gate          = await ask(rl, `  Gate           [GATE_1]              : `);

  const finalCardId        = cardId.trim()        || 'CUSTOM_001';
  const finalVehicleNumber = vehicleNumber.trim() || 'TS 09 AB 0000';
  const finalGate          = gate.trim()          || 'GATE_1';
  const timestamp          = now();

  printScanData(finalCardId, finalVehicleNumber, finalGate, 1, timestamp);

  console.log('  Sending to Temporal...');

  try {
    const workflowId = await triggerWF1({
      cardId:        finalCardId,
      vehicleNumber: finalVehicleNumber,
      gate:          finalGate,
      timestamp,
      portNum:       1,
    });

    lastWF1Id = workflowId;
    lastWF3Id = childWf3Id(finalCardId, timestamp);
    lastWF9Id = childWf9Id(finalCardId, timestamp);
    printResult(workflowId, 'WF1 started with custom data!');
  } catch (err) {
    printError(err);
  }
}

// ═══════════════════════════════════════════════════════════════
//  MENU
// ═══════════════════════════════════════════════════════════════

function printHeader(): void {
  console.clear();
  console.log('');
  console.log(bold(cyan('  ╔══════════════════════════════════════════════════════════╗')));
  console.log(bold(cyan('  ║       CYBER TOWERS — RFID SCAN SIMULATOR                ║')));
  console.log(bold(cyan('  ║       Temporal Workflow Tester                          ║')));
  console.log(bold(cyan('  ╚══════════════════════════════════════════════════════════╝')));
  console.log('');
  console.log(`  ${bold('Temporal Web UI')}  :  ${cyan('http://localhost:8233')}`);
  console.log(`  ${bold('Worker status')}    :  ${dim('make sure "npm run worker:dev" is running in another terminal')}`);

  if (lastWF1Id || lastWF3Id || lastWF9Id) {
    console.log('');
    if (lastWF1Id) {
      console.log(`  ${bold('WF1 ID (exit signal)')} :  ${yellow(lastWF1Id)}`);
      console.log(`  ${bold('Track WF1')}            :  ${cyan(`http://localhost:8233/namespaces/default/workflows/${encodeURIComponent(lastWF1Id)}`)}`);
    }
    if (lastWF3Id) {
      console.log(`  ${bold('WF3 ID (sec decision)')}:  ${yellow(lastWF3Id)}`);
    }
    if (lastWF9Id) {
      console.log(`  ${bold('WF9 ID (override)')}    :  ${yellow(lastWF9Id)}`);
    }
  }

  console.log('');
  console.log(dim('  ─────────────────────────────────────────────────────────'));
  console.log('');
  console.log(bold('  ENTRY SCANS (simulate vehicle arriving at gate)'));
  console.log('');
  console.log(`  ${bold('1')}  →  ${green('Authorized Entry')}           Card: ${DUMMY_CARDS[0].label}`);
  console.log(`  ${bold('2')}  →  ${green('Authorized Entry')}           Card: ${DUMMY_CARDS[1].label}`);
  console.log(`  ${bold('3')}  →  ${red('Unauthorized Entry')}          Card: ${DUMMY_CARDS[2].label}  ${dim('→ WF3')}`);
  console.log(`  ${bold('4')}  →  ${yellow('Full Cycle (Entry + Auto-Exit in 30s)')}  Card: ${DUMMY_CARDS[0].label}`);
  console.log(`  ${bold('5')}  →  ${cyan('Custom Card ID')}             Enter your own cardId + vehicle`);
  console.log('');
  console.log(bold('  EXIT SIGNALS (send to WF1 — authorized entry path)'));
  console.log('');
  console.log(`  ${bold('6')}  →  Send ${green('EXIT SIGNAL')}  to WF1${lastWF1Id ? yellow(' ← ' + lastWF1Id.substring(0, 40) + '...') : ''}`);
  console.log('');
  console.log(bold('  WF3 — UNAUTHORIZED APPROVAL  (signals WF3, not WF1)'));
  console.log('');
  console.log(`  ${bold('7')}  →  WF3: ${green('APPROVE')}  (security lets the vehicle in)${lastWF3Id ? dim('  → ' + lastWF3Id.substring(0, 36) + '...') : ''}`);
  console.log(`  ${bold('8')}  →  WF3: ${red('DENY')}     (security turns the vehicle away)`);
  console.log('');
  console.log(bold('  WF9 — QUOTA OVERRIDE  (signals WF9, not WF1)'));
  console.log('');
  console.log(`  ${bold('9')}  →  WF9: Send ${yellow('OVERRIDE REQUEST')}  (security desk requests it)${lastWF9Id ? dim('  → ' + lastWF9Id.substring(0, 30) + '...') : ''}`);
  console.log(`  ${bold('a')}  →  WF9: Admin ${green('APPROVE')}          (company admin approves)`);
  console.log(`  ${bold('b')}  →  WF9: Admin ${red('DENY')}              (company admin denies)`);
  console.log('');
  console.log(dim('  ─────────────────────────────────────────────────────────'));
  console.log('');
  console.log(`  ${bold('0')}  →  Quit`);
  console.log('');
}

// ─── HELPER: promise-based readline question ─────────────────
function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

// ─── HELPER: sleep (used for auto-exit) ──────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── MAIN LOOP ────────────────────────────────────────────────
async function main(): Promise<void> {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  let running = true;

  while (running) {
    printHeader();

    const choice = await ask(rl, `  ${bold('Enter choice')} (0–9, a, b): `);
    const trimmed = choice.trim().toLowerCase();

    console.log('');
    console.log(dim('  ──────────────────────────────────────────────────────────'));

    switch (trimmed) {
      case '1': await triggerScan(0, false); break;
      case '2': await triggerScan(1, false); break;
      case '3': await triggerScan(2, false); break;  // FAKE card → WF3
      case '4': await triggerScan(0, true);  break;  // auto-exit in 30s
      case '5': await doCustomScan(rl);      break;
      case '6': await doSendExit(rl);        break;
      case '7': await doSecurityDecision(rl, 'approve'); break;
      case '8': await doSecurityDecision(rl, 'deny');    break;
      case '9': await doOverrideRequest(rl);             break;
      case 'a': await doAdminDecision(rl, 'approve');    break;
      case 'b': await doAdminDecision(rl, 'deny');       break;
      case '0':
        console.log('');
        console.log(green('  Goodbye! Watch your workflows at http://localhost:8233'));
        console.log('');
        running = false;
        break;
      default:
        console.log(yellow(`  Unknown option: "${trimmed}" — try again.`));
        break;
    }

    if (running) {
      await ask(rl, `  ${dim('Press Enter to return to menu...')} `);
    }
  }

  rl.close();
}

// ─── START ────────────────────────────────────────────────────
main().catch((err) => {
  console.error(red(`\nFatal error: ${err.message}`));
  console.error(err);
  process.exit(1);
});
