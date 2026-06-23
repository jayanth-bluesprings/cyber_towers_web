-- =============================================================================
-- cybertowers_access — Complete PostgreSQL Schema
-- Database: cybertowers_access
-- Generated for: Cyber Towers Vehicle Access Dashboard
-- Compatible: PostgreSQL 14+
-- Run in pgAdmin: connect to target server, open Query Tool, paste & execute.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. DATABASE (run once as superuser; skip if DB already created)
-- ---------------------------------------------------------------------------

-- CREATE DATABASE cybertowers_access
--     ENCODING 'UTF8'
--     LC_COLLATE 'en_US.UTF-8'
--     LC_CTYPE   'en_US.UTF-8'
--     TEMPLATE template0;

-- \c cybertowers_access

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- trigram indexes for name search

-- ---------------------------------------------------------------------------
-- 1. SCHEMA
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS cybertowers;

SET search_path TO cybertowers, public;

-- ---------------------------------------------------------------------------
-- 2. ENUM TYPES
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE cybertowers.controller_type_enum AS ENUM ('Unknown','FC8900','FC8900H');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cybertowers.sync_type_enum AS ENUM ('Startup','Scheduled','Manual','PostReconnect');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cybertowers.sync_status_enum AS ENUM ('Running','Success','Failed','Partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cybertowers.access_result_enum AS ENUM ('Granted','Denied','Alarm','System','Unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cybertowers.alert_severity_enum AS ENUM ('Critical','High','Medium','Low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cybertowers.event_source_enum AS ENUM ('Live','Sync');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cybertowers.card_status_enum AS ENUM ('Active','Suspended','Deleted','Expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cybertowers.card_type_enum AS ENUM ('Normal','FirstCard','AlwaysOpen','Patrol','AntiTheft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cybertowers.direction_enum AS ENUM ('In','Out','N/A');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. COMPANIES (tenants)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.companies (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(20) NOT NULL,
    name                VARCHAR(150) NOT NULL,
    address             TEXT,
    contact_email       VARCHAR(150),
    contact_phone       VARCHAR(30),
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    -- audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT uq_companies_code UNIQUE (code)
);

COMMENT ON TABLE  cybertowers.companies IS 'Tenant companies registered in the building.';
COMMENT ON COLUMN cybertowers.companies.code IS 'Short unique company code (e.g. "GOOGLE","WIPRO").';

-- ---------------------------------------------------------------------------
-- 4. ROLES & PERMISSIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.roles (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(50) NOT NULL,
    description TEXT,
    is_system   BOOLEAN     NOT NULL DEFAULT FALSE,   -- system roles cannot be deleted
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_roles_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS cybertowers.permissions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    resource    VARCHAR(80) NOT NULL,   -- e.g. 'scan_events', 'controllers', 'users'
    action      VARCHAR(30) NOT NULL,   -- e.g. 'read', 'write', 'delete', 'export'
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_permissions_resource_action UNIQUE (resource, action)
);

CREATE TABLE IF NOT EXISTS cybertowers.role_permissions (
    role_id       UUID NOT NULL REFERENCES cybertowers.roles(id)       ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES cybertowers.permissions(id) ON DELETE CASCADE,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by    UUID,

    PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- 5. USERS (dashboard operators / admins)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.users (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(150) NOT NULL,
    name                VARCHAR(150) NOT NULL,
    password_hash       TEXT        NOT NULL,       -- bcrypt hash
    role_id             UUID        REFERENCES cybertowers.roles(id),
    company_id          UUID        REFERENCES cybertowers.companies(id),
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    must_change_password BOOLEAN    NOT NULL DEFAULT FALSE,
    -- audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT uq_users_email UNIQUE (email)
);

COMMENT ON TABLE  cybertowers.users IS 'Dashboard operator accounts (not card holders).';

-- ---------------------------------------------------------------------------
-- 6. CONTROLLERS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.controllers (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sn                  VARCHAR(30) NOT NULL,            -- TimeWatch serial number
    ip_address          INET        NOT NULL,
    tcp_port            INTEGER     NOT NULL DEFAULT 8000,
    udp_port            INTEGER     NOT NULL DEFAULT 8101,
    password_encrypted  TEXT        NOT NULL,            -- AES-256 encrypted 8-hex-char password
    door_count          SMALLINT    NOT NULL DEFAULT 1 CHECK (door_count BETWEEN 1 AND 4),
    controller_type     cybertowers.controller_type_enum NOT NULL DEFAULT 'FC8900',
    location_label      VARCHAR(100),
    door_labels         JSONB       NOT NULL DEFAULT '{}',  -- {1:"Entry",2:"Exit"}
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    company_id          UUID        NOT NULL REFERENCES cybertowers.companies(id),
    notes               TEXT,
    -- audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT uq_controllers_sn UNIQUE (sn)
);

COMMENT ON TABLE  cybertowers.controllers IS 'TimeWatch FC8900/FC8900H access-control hardware units.';
COMMENT ON COLUMN cybertowers.controllers.sn IS 'Immutable hardware serial number — the business key used throughout the system.';
COMMENT ON COLUMN cybertowers.controllers.password_encrypted IS 'AES-256-CBC encrypted. Decrypted at runtime by the Bridge using BRIDGE_ENCRYPTION_KEY env var.';
COMMENT ON COLUMN cybertowers.controllers.door_labels IS 'JSONB map of 1-based door number → human label, e.g. {"1":"Entry","2":"Exit"}.';

-- ---------------------------------------------------------------------------
-- 7. CONTROLLER STATUS (runtime heartbeat snapshot)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.controller_status (
    controller_id           UUID        PRIMARY KEY REFERENCES cybertowers.controllers(id) ON DELETE CASCADE,
    is_online               BOOLEAN     NOT NULL DEFAULT FALSE,
    last_heartbeat_at       TIMESTAMPTZ,
    consecutive_failures    INTEGER     NOT NULL DEFAULT 0,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cybertowers.controller_status IS 'Live connectivity snapshot, maintained by PATCH /internal/bridge/controller-status. One row per controller, upserted every heartbeat.';

-- ---------------------------------------------------------------------------
-- 8. ACCESS GROUPS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.access_groups (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    company_id  UUID        REFERENCES cybertowers.companies(id),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,

    CONSTRAINT uq_access_groups_name_company UNIQUE (name, company_id)
);

-- Maps which access groups are allowed through which controller doors
CREATE TABLE IF NOT EXISTS cybertowers.access_group_doors (
    access_group_id UUID    NOT NULL REFERENCES cybertowers.access_groups(id) ON DELETE CASCADE,
    controller_id   UUID    NOT NULL REFERENCES cybertowers.controllers(id)   ON DELETE CASCADE,
    door_num        SMALLINT NOT NULL CHECK (door_num BETWEEN 1 AND 4),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (access_group_id, controller_id, door_num)
);

-- ---------------------------------------------------------------------------
-- 9. CARDS (registered RFID card holders / vehicles)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.cards (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    card_no         VARCHAR(30) NOT NULL,            -- Wiegand decimal string from controller
    person_name     VARCHAR(150),
    person_code     VARCHAR(30),                     -- employee / resident code
    company_id      UUID        REFERENCES cybertowers.companies(id),
    department      VARCHAR(100),
    vehicle_number  VARCHAR(20),
    vehicle_type    VARCHAR(50),
    card_type       cybertowers.card_type_enum  NOT NULL DEFAULT 'Normal',
    card_status     cybertowers.card_status_enum NOT NULL DEFAULT 'Active',
    access_group_id UUID        REFERENCES cybertowers.access_groups(id),
    valid_from      DATE,
    valid_until     DATE,
    notes           TEXT,
    -- audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT uq_cards_card_no UNIQUE (card_no)
);

COMMENT ON TABLE  cybertowers.cards IS 'Registered RFID cards — each corresponds to a vehicle owner / resident / employee.';
COMMENT ON COLUMN cybertowers.cards.card_no IS 'Wiegand decimal card number as decoded by the TimeWatch SDK.';

-- ---------------------------------------------------------------------------
-- 10. SCAN EVENTS (partitioned by month)
-- ---------------------------------------------------------------------------
-- Range-partitioned on event_date (UTC). Each month is a separate partition.
-- Partition key = event_date (the timestamp on the controller record).
-- New partitions must be created monthly (see partition creation section below).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.scan_events (
    id              BIGSERIAL,
    event_date      TIMESTAMPTZ NOT NULL,               -- controller device clock (UTC)
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- wall-clock when bridge received it
    card_no         VARCHAR(30) NOT NULL DEFAULT '',
    controller_sn   VARCHAR(30) NOT NULL,
    door_num        SMALLINT    NOT NULL DEFAULT 1,
    direction       VARCHAR(10) NOT NULL DEFAULT 'N/A',
    record_type     VARCHAR(30) NOT NULL DEFAULT '',
    event_code      VARCHAR(100) NOT NULL DEFAULT '',
    event_code_int  INTEGER,
    access_result   cybertowers.access_result_enum  NOT NULL DEFAULT 'Unknown',
    denial_reason   VARCHAR(200),
    is_alert        BOOLEAN     NOT NULL DEFAULT FALSE,
    alert_severity  cybertowers.alert_severity_enum,
    source          cybertowers.event_source_enum NOT NULL DEFAULT 'Live',
    -- denormalised lookups (cached at insert time to avoid joins on hot queries)
    person_name     VARCHAR(150),
    company_code    VARCHAR(30),
    vehicle_number  VARCHAR(20),
    location_label  VARCHAR(100),
    -- audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, event_date)
) PARTITION BY RANGE (event_date);

COMMENT ON TABLE  cybertowers.scan_events IS 'All access-control events from all controllers, range-partitioned by event_date month.';
COMMENT ON COLUMN cybertowers.scan_events.card_no IS 'Empty string for door/alarm events that carry no card number.';
COMMENT ON COLUMN cybertowers.scan_events.person_name IS 'Denormalised from cards table at insert time — avoids joins on reporting queries.';

-- ---------------------------------------------------------------------------
-- 10a. SCAN_EVENTS PARTITIONS
-- Pre-create partitions for 2025 and 2026. Add new ones each month.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_01
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_02
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_03
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_04
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_05
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_06
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_07
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_08
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_09
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_10
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_11
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2025_12
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_01
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_02
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_03
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_04
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_05
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_06
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_07
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_08
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_09
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_10
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_11
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE IF NOT EXISTS cybertowers.scan_events_2026_12
    PARTITION OF cybertowers.scan_events
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Default partition catches anything outside the pre-created ranges
CREATE TABLE IF NOT EXISTS cybertowers.scan_events_default
    PARTITION OF cybertowers.scan_events DEFAULT;

-- ---------------------------------------------------------------------------
-- 11. SYNC LOG (Bridge historical-sync audit trail)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.sync_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    controller_id   UUID        NOT NULL REFERENCES cybertowers.controllers(id) ON DELETE CASCADE,
    sync_type       cybertowers.sync_type_enum   NOT NULL DEFAULT 'Scheduled',
    rec_type_index  SMALLINT    NOT NULL,   -- SDK record type: 0=Normal,1=Card,2=Alarm,etc.
    status          cybertowers.sync_status_enum NOT NULL DEFAULT 'Running',
    pulled_count    INTEGER,
    inserted_count  INTEGER,
    duplicate_count INTEGER,
    error_message   TEXT,
    retry_count     SMALLINT    NOT NULL DEFAULT 0,
    next_retry_at   TIMESTAMPTZ,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    -- audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  cybertowers.sync_log IS 'Audit trail for each historical getRecord() sync pass. One row per (controller × recTypeIndex) attempt.';
COMMENT ON COLUMN cybertowers.sync_log.rec_type_index IS 'SDK WatchRecordDecompile type index: 0=Normal, 1=Card, 2=Alarm, 3=DoorOpen, 4=DoorClose, 5=AlarmRecord.';

-- ---------------------------------------------------------------------------
-- 12. ALERTS (escalated events requiring operator acknowledgement)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.alerts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_event_id   BIGINT      NOT NULL,    -- references scan_events.id (without partition key — use with event_date)
    scan_event_date TIMESTAMPTZ NOT NULL,    -- needed to locate the partition row
    controller_sn   VARCHAR(30) NOT NULL,
    severity        cybertowers.alert_severity_enum NOT NULL,
    event_code      VARCHAR(100) NOT NULL,
    card_no         VARCHAR(30),
    location_label  VARCHAR(100),
    is_acknowledged BOOLEAN     NOT NULL DEFAULT FALSE,
    acknowledged_by UUID        REFERENCES cybertowers.users(id),
    acknowledged_at TIMESTAMPTZ,
    notes           TEXT,
    -- audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  cybertowers.alerts IS 'Alert events that require operator acknowledgement. Created by the bridge route when is_alert=true.';

-- ---------------------------------------------------------------------------
-- 13. PARKING ALLOCATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.parking_allocations (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID        NOT NULL REFERENCES cybertowers.companies(id),
    total_slots     INTEGER     NOT NULL DEFAULT 0 CHECK (total_slots >= 0),
    notes           TEXT,
    -- audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_parking_company UNIQUE (company_id)
);

COMMENT ON TABLE cybertowers.parking_allocations IS 'Allocated parking slot quota per company.';

-- ---------------------------------------------------------------------------
-- 14. LOCAL ACCESS APPROVALS (temporary overrides — mirror of frontend localStorage)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.access_approvals (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    card_no         VARCHAR(30) NOT NULL,
    vehicle_number  VARCHAR(20),
    remark          TEXT,
    approved_by     UUID        REFERENCES cybertowers.users(id),
    expires_at      TIMESTAMPTZ,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    -- audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_access_approvals_card_no UNIQUE (card_no)
);

-- ---------------------------------------------------------------------------
-- 15. AUDIT LOG (generic change log for sensitive operations)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cybertowers.audit_log (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     UUID        REFERENCES cybertowers.users(id),
    action      VARCHAR(80) NOT NULL,   -- e.g. 'card.updated', 'controller.deleted'
    entity_type VARCHAR(50) NOT NULL,   -- table name, e.g. 'cards', 'controllers'
    entity_id   TEXT        NOT NULL,   -- UUID or other PK as text
    old_data    JSONB,
    new_data    JSONB,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cybertowers.audit_log IS 'Append-only change log for sensitive operations (card edits, controller config changes, etc.).';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- companies
CREATE INDEX IF NOT EXISTS idx_companies_code   ON cybertowers.companies(code);
CREATE INDEX IF NOT EXISTS idx_companies_active ON cybertowers.companies(is_active) WHERE is_active = TRUE;

-- controllers
CREATE INDEX IF NOT EXISTS idx_controllers_sn          ON cybertowers.controllers(sn);
CREATE INDEX IF NOT EXISTS idx_controllers_company     ON cybertowers.controllers(company_id);
CREATE INDEX IF NOT EXISTS idx_controllers_active      ON cybertowers.controllers(is_active) WHERE is_active = TRUE AND deleted_at IS NULL;

-- controller_status
CREATE INDEX IF NOT EXISTS idx_controller_status_online ON cybertowers.controller_status(is_online);

-- cards
CREATE INDEX IF NOT EXISTS idx_cards_card_no      ON cybertowers.cards(card_no);
CREATE INDEX IF NOT EXISTS idx_cards_company      ON cybertowers.cards(company_id);
CREATE INDEX IF NOT EXISTS idx_cards_status       ON cybertowers.cards(card_status);
CREATE INDEX IF NOT EXISTS idx_cards_vehicle_no   ON cybertowers.cards(vehicle_number) WHERE vehicle_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cards_person_name  ON cybertowers.cards USING gin (person_name gin_trgm_ops);

-- scan_events (indexes on partitioned table — propagates to all partitions)
CREATE INDEX IF NOT EXISTS idx_scan_events_event_date       ON cybertowers.scan_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_card_no_date     ON cybertowers.scan_events(card_no, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_controller_date  ON cybertowers.scan_events(controller_sn, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_access_result    ON cybertowers.scan_events(access_result, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_is_alert         ON cybertowers.scan_events(is_alert, event_date DESC) WHERE is_alert = TRUE;
CREATE INDEX IF NOT EXISTS idx_scan_events_received_at      ON cybertowers.scan_events(received_at DESC);

-- sync_log
CREATE INDEX IF NOT EXISTS idx_sync_log_controller     ON cybertowers.sync_log(controller_id, rec_type_index);
CREATE INDEX IF NOT EXISTS idx_sync_log_status_retry   ON cybertowers.sync_log(status, next_retry_at) WHERE status = 'Failed';
CREATE INDEX IF NOT EXISTS idx_sync_log_started_at     ON cybertowers.sync_log(started_at DESC);

-- alerts
CREATE INDEX IF NOT EXISTS idx_alerts_unack        ON cybertowers.alerts(is_acknowledged, created_at DESC) WHERE is_acknowledged = FALSE;
CREATE INDEX IF NOT EXISTS idx_alerts_controller   ON cybertowers.alerts(controller_sn, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity     ON cybertowers.alerts(severity, created_at DESC);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_user       ON cybertowers.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity     ON cybertowers.audit_log(entity_type, entity_id, created_at DESC);

-- access_approvals
CREATE INDEX IF NOT EXISTS idx_access_approvals_card ON cybertowers.access_approvals(card_no) WHERE is_active = TRUE;

-- role_permissions
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON cybertowers.role_permissions(role_id);

-- parking
CREATE INDEX IF NOT EXISTS idx_parking_company ON cybertowers.parking_allocations(company_id);

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

INSERT INTO cybertowers.roles (id, name, description, is_system) VALUES
    ('00000000-0000-0000-0000-000000000001', 'SuperAdmin',    'Full system access. Cannot be deleted.',               TRUE),
    ('00000000-0000-0000-0000-000000000002', 'Admin',         'Manage controllers, cards, users, and view all data.', TRUE),
    ('00000000-0000-0000-0000-000000000003', 'Operator',      'Monitor live events and acknowledge alerts.',          TRUE),
    ('00000000-0000-0000-0000-000000000004', 'SecurityGuard', 'View live feed and approve temporary access only.',    TRUE),
    ('00000000-0000-0000-0000-000000000005', 'ReportViewer',  'Read-only access to reports and exports.',             TRUE)
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

INSERT INTO cybertowers.permissions (resource, action, description) VALUES
    -- scan_events
    ('scan_events',      'read',         'View live and historical scan events'),
    ('scan_events',      'export',        'Export scan events to CSV/PDF'),
    -- alerts
    ('alerts',           'read',          'View active and historical alerts'),
    ('alerts',           'acknowledge',   'Acknowledge and close alerts'),
    -- controllers
    ('controllers',      'read',          'View controller list and status'),
    ('controllers',      'write',         'Add or modify controller configuration'),
    ('controllers',      'delete',        'Remove a controller'),
    -- cards
    ('cards',            'read',          'View card holder list'),
    ('cards',            'write',         'Add or edit cards'),
    ('cards',            'delete',        'Soft-delete cards'),
    ('cards',            'sync',          'Push card data to controllers'),
    -- access_approvals
    ('access_approvals', 'read',          'View temporary access approvals'),
    ('access_approvals', 'write',         'Create or revoke temporary approvals'),
    -- parking
    ('parking',          'read',          'View parking allocations'),
    ('parking',          'write',         'Edit parking slot quotas'),
    -- users
    ('users',            'read',          'View user accounts'),
    ('users',            'write',         'Create and edit user accounts'),
    ('users',            'delete',        'Deactivate user accounts'),
    -- roles
    ('roles',            'read',          'View roles and permissions'),
    ('roles',            'write',         'Assign permissions to roles'),
    -- reports
    ('reports',          'read',          'View session and occupancy reports'),
    ('reports',          'export',        'Export reports to CSV/PDF'),
    -- system
    ('system',           'config',        'Edit system-level settings'),
    ('system',           'audit_log',     'View the audit log')
ON CONFLICT (resource, action) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Role → Permission mapping
-- ---------------------------------------------------------------------------

-- SuperAdmin: all permissions
INSERT INTO cybertowers.role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001', id FROM cybertowers.permissions
ON CONFLICT DO NOTHING;

-- Admin: everything except system.config and system.audit_log
INSERT INTO cybertowers.role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000002', p.id
FROM cybertowers.permissions p
WHERE NOT (p.resource = 'system')
ON CONFLICT DO NOTHING;

-- Operator: scan_events read/export, alerts read/acknowledge, controllers read, cards read, reports
INSERT INTO cybertowers.role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000003', p.id
FROM cybertowers.permissions p
WHERE (p.resource = 'scan_events'  AND p.action IN ('read','export'))
   OR (p.resource = 'alerts'       AND p.action IN ('read','acknowledge'))
   OR (p.resource = 'controllers'  AND p.action = 'read')
   OR (p.resource = 'cards'        AND p.action = 'read')
   OR (p.resource = 'parking'      AND p.action = 'read')
   OR (p.resource = 'reports'      AND p.action IN ('read','export'))
   OR (p.resource = 'access_approvals' AND p.action IN ('read','write'))
ON CONFLICT DO NOTHING;

-- SecurityGuard: scan_events read, alerts read, access_approvals read+write
INSERT INTO cybertowers.role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000004', p.id
FROM cybertowers.permissions p
WHERE (p.resource = 'scan_events'      AND p.action = 'read')
   OR (p.resource = 'alerts'           AND p.action = 'read')
   OR (p.resource = 'access_approvals' AND p.action IN ('read','write'))
ON CONFLICT DO NOTHING;

-- ReportViewer: scan_events export, reports read+export
INSERT INTO cybertowers.role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000005', p.id
FROM cybertowers.permissions p
WHERE (p.resource = 'scan_events' AND p.action IN ('read','export'))
   OR (p.resource = 'reports'     AND p.action IN ('read','export'))
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Default company (Cyber Towers building management)
-- ---------------------------------------------------------------------------

INSERT INTO cybertowers.companies (id, code, name, address) VALUES
    ('10000000-0000-0000-0000-000000000001', 'CTOWERS', 'Cyber Towers Building Management', 'Cyber Towers, Hitech City, Hyderabad')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Access Groups (standard set)
-- ---------------------------------------------------------------------------

INSERT INTO cybertowers.access_groups (id, name, description, company_id) VALUES
    ('20000000-0000-0000-0000-000000000001', 'All Access',          'Unrestricted access to all doors 24×7',      '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000002', 'Business Hours',      'Access during business hours only (8am–8pm)', '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000003', 'Visitor',             'Visitor temporary pass — main gate only',     '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000004', 'Security Staff',      'Access to all doors including back-of-house', '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000005', 'Delivery',            'Service gate only during daytime hours',      '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000006', 'Parking Only',        'Basement parking barrier only',               '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000007', 'Emergency Services',  'Override all doors — fire/security teams',    '10000000-0000-0000-0000-000000000001')
ON CONFLICT (name, company_id) DO NOTHING;

-- =============================================================================
-- HELPER FUNCTION: create next month's partition automatically
-- Call: SELECT cybertowers.create_monthly_partition('2027-01-01'::date);
-- =============================================================================

CREATE OR REPLACE FUNCTION cybertowers.create_monthly_partition(partition_start DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    partition_end   DATE := partition_start + INTERVAL '1 month';
    partition_name  TEXT := 'scan_events_' || TO_CHAR(partition_start, 'YYYY_MM');
    full_name       TEXT := 'cybertowers.' || partition_name;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'cybertowers' AND c.relname = partition_name
    ) THEN
        EXECUTE FORMAT(
            'CREATE TABLE %I.%I PARTITION OF cybertowers.scan_events FOR VALUES FROM (%L) TO (%L)',
            'cybertowers', partition_name, partition_start, partition_end
        );
        RAISE NOTICE 'Created partition: %', full_name;
    ELSE
        RAISE NOTICE 'Partition already exists: %', full_name;
    END IF;
END;
$$;

COMMENT ON FUNCTION cybertowers.create_monthly_partition IS
    'Creates a monthly range partition for scan_events. Call once per month before the month starts, e.g. via a pg_cron job.';

-- =============================================================================
-- UPDATED_AT TRIGGER (auto-update updated_at on any UPDATE)
-- =============================================================================

CREATE OR REPLACE FUNCTION cybertowers.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_companies_updated_at
    BEFORE UPDATE ON cybertowers.companies
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_controllers_updated_at
    BEFORE UPDATE ON cybertowers.controllers
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_controller_status_updated_at
    BEFORE UPDATE ON cybertowers.controller_status
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_cards_updated_at
    BEFORE UPDATE ON cybertowers.cards
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON cybertowers.users
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_access_groups_updated_at
    BEFORE UPDATE ON cybertowers.access_groups
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_sync_log_updated_at
    BEFORE UPDATE ON cybertowers.sync_log
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_alerts_updated_at
    BEFORE UPDATE ON cybertowers.alerts
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_parking_updated_at
    BEFORE UPDATE ON cybertowers.parking_allocations
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

CREATE OR REPLACE TRIGGER trg_access_approvals_updated_at
    BEFORE UPDATE ON cybertowers.access_approvals
    FOR EACH ROW EXECUTE FUNCTION cybertowers.set_updated_at();

-- =============================================================================
-- MIGRATION ORDER SUMMARY (documentation only)
-- =============================================================================
-- 01. CREATE EXTENSION pgcrypto, pg_trgm
-- 02. CREATE SCHEMA cybertowers
-- 03. CREATE TYPE  (all enums)
-- 04. CREATE TABLE companies
-- 05. CREATE TABLE roles
-- 06. CREATE TABLE permissions
-- 07. CREATE TABLE role_permissions
-- 08. CREATE TABLE users
-- 09. CREATE TABLE controllers
-- 10. CREATE TABLE controller_status
-- 11. CREATE TABLE access_groups
-- 12. CREATE TABLE access_group_doors
-- 13. CREATE TABLE cards
-- 14. CREATE TABLE scan_events (partitioned)
-- 15. CREATE TABLE scan_events_YYYY_MM (partitions)
-- 16. CREATE TABLE scan_events_default
-- 17. CREATE TABLE sync_log
-- 18. CREATE TABLE alerts
-- 19. CREATE TABLE parking_allocations
-- 20. CREATE TABLE access_approvals
-- 21. CREATE TABLE audit_log
-- 22. CREATE INDEX (all)
-- 23. SEED  roles
-- 24. SEED  permissions
-- 25. SEED  role_permissions
-- 26. SEED  companies (default)
-- 27. SEED  access_groups
-- 28. CREATE FUNCTION create_monthly_partition
-- 29. CREATE FUNCTION set_updated_at
-- 30. CREATE TRIGGER (all updated_at triggers)
-- =============================================================================
