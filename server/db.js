const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ensure data folder exists
let DATA_DIR = path.join(__dirname, '..', 'data');
if (fs.existsSync('/home/u727870701')) {
    DATA_DIR = '/home/u727870701/domains/repuestoscajica.com/public_html/upsseler/consolo/data';
}
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}


// Global DB Connection
const globalDbPath = path.join(DATA_DIR, 'global.db');
const globalDb = new DatabaseSync(globalDbPath);

// Initialize Global Schema
globalDb.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nit TEXT NOT NULL,
        dv TEXT,
        address TEXT,
        email TEXT,
        phone TEXT,
        dian_enabled INTEGER DEFAULT 0,
        dian_test_id TEXT,
        dian_pin TEXT,
        dian_software_id TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL, -- 'admin', 'cashier', 'accountant'
        active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS global_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        tenant_id TEXT,
        username TEXT,
        action TEXT NOT NULL,
        details TEXT
    );

    CREATE TABLE IF NOT EXISTS mercadolibre_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        account_name TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        expires_at DATETIME,
        seller_id TEXT,
        active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS mercadolibre_items_status (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        sku TEXT NOT NULL,
        title TEXT NOT NULL,
        price REAL,
        status TEXT NOT NULL, -- 'active', 'paused', 'deleted'
        modificado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mercadolibre_questions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_name TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_title TEXT NOT NULL,
        question_text TEXT NOT NULL,
        status TEXT NOT NULL, -- 'unanswered', 'answered'
        answer_text TEXT,
        date_created DATETIME DEFAULT CURRENT_TIMESTAMP,
        buyer_nickname TEXT NOT NULL
    );
`);

// Seed mock questions if empty
try {
    const questionCount = globalDb.prepare("SELECT COUNT(*) as count FROM mercadolibre_questions").get().count;
    if (questionCount === 0) {
        const insertQuestion = globalDb.prepare(`
            INSERT INTO mercadolibre_questions (id, tenant_id, account_name, seller_id, item_id, item_title, question_text, status, buyer_nickname, date_created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertQuestion.run('q_mock_1', 'importadora', 'patucarro', '123456', 'MCO-99123', 'Filtro de Aceite Chevrolet Spark GT', '¿Este filtro le sirve al Spark GT modelo 2017?', 'unanswered', 'MIGUEL_GOMEZ', new Date(Date.now() - 10 * 60 * 1000).toISOString());
        insertQuestion.run('q_mock_2', 'importadora', 'kyh', '789012', 'MCO-99124', 'Batería Bosch 12v 60ah Automóvil', '¿Tiene garantía de cuántos meses?', 'unanswered', 'CARLOS_PEREZ', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    }
} catch (e) {
    console.error("Failed to seed mock questions:", e);
}

// Insert default tenants if empty
const tenantCount = globalDb.prepare("SELECT COUNT(*) as count FROM tenants").get().count;
if (tenantCount === 0) {
    const insertTenant = globalDb.prepare(`
        INSERT INTO tenants (id, name, nit, dv, address, email, phone, dian_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertTenant.run('importadora', 'IMPORTADORA KYH SAS', '901785745', '5', 'Carrera 6 # 0 - 56 Cajica', 'contacto@repuestoscajica.com', '2334354950', 0);
    insertTenant.run('club', 'Club Sol del Valle', '900123456', '8', 'Km 5 Vía al Balneario, Melgar', 'info@soldelvalle.com', '3102222222', 0);
}

// Force update importadora to use the real DIAN resolution details
try {
    globalDb.prepare(`
        UPDATE tenants 
        SET name = 'IMPORTADORA KYH SAS',
            nit = '901785745',
            dv = '5',
            address = 'Carrera 6 # 0 - 56 Cajica',
            email = 'contacto@repuestoscajica.com',
            phone = '2334354950'
        WHERE id = 'importadora'
    `).run();
} catch (err) {
    console.error("Failed to update tenant details:", err);
}

// Insert default admin user if empty
const userCount = globalDb.prepare("SELECT COUNT(*) as count FROM users").get().count;
if (userCount === 0) {
    const insertUser = globalDb.prepare(`
        INSERT INTO users (username, password_hash, full_name, role)
        VALUES (?, ?, ?, ?)
    `);
    // Default password is 'admin123' (we store plain text or simple hash here for local dev, let's use a simple SHA256 or mock)
    insertUser.run('admin', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'Administrador General', 'admin');
}

// Migration: add identificacion to users table
try {
    globalDb.exec("ALTER TABLE users ADD COLUMN identificacion TEXT;");
} catch (e) {
    // Ignore, column already exists
}

// Migration: add seller_id to mercadolibre_accounts table
try {
    globalDb.exec("ALTER TABLE mercadolibre_accounts ADD COLUMN seller_id TEXT;");
} catch (e) {
    // Ignore, column already exists
}

// Migration: add thumbnail to mercadolibre_items_status table
try {
    globalDb.exec("ALTER TABLE mercadolibre_items_status ADD COLUMN thumbnail TEXT;");
} catch (e) {
    // Ignore, column already exists
}


// Cache of tenant DB connections
const tenantDbCache = {};

function ensureCriticalAccounts(db) {
    const stmt = db.prepare(`
        INSERT INTO puc (codigo, nombre, requiere_tercero, requiere_centro_costo, parent_codigo)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(codigo) DO NOTHING
    `);
    
    const criticalAccounts = [
        ['11050501', 'CAJA GENERAL TENANT', 1, 0, '110505'],
        ['11100508', 'BANCOLOMBIA', 1, 0, '111005'],
        ['11100510', 'NEQUI', 1, 0, '111005'],
        ['11100512', 'MERCADO PAGO', 1, 0, '111005'],
        ['130505', 'NACIONALES (CLIENTES)', 1, 0, '1305'],
        ['13050501', 'CLIENTES NACIONALES', 1, 0, '130505'],
        ['143501', 'INVENTARIO MERCANCIAS', 0, 0, '1435'],
        ['2205', 'PROVEEDORES NACIONALES', 1, 0, '22'],
        ['2365', 'RETENCION EN LA FUENTE POR PAGAR', 1, 0, '23'],
        ['2408', 'IMPUESTO SOBRE LAS VENTAS POR PAGAR (IVA)', 1, 0, '24'],
        ['413501', 'VENTAS GENERALES', 1, 1, '4135'],
        ['613501', 'COSTO VENTAS GENERALES', 1, 1, '6135'],
        ['510506', 'SUELDOS Y BENEFICIOS', 1, 0, '5105'],
        ['5120', 'ARRENDAMIENTOS', 0, 0, '51'],
        ['512005', 'ARRENDAMIENTOS (ARRIENDO)', 1, 0, '5120'],
        ['5195', 'DIVERSOS', 0, 0, '51'],
        ['519505', 'COMISIONES MERCADO LIBRE', 1, 0, '5195'],
        ['519595', 'COMBUSTIBLES Y LUBRICANTES (GASOLINA)', 1, 0, '5195'],
        ['237005', 'APORTES A SALUD (EPS)', 1, 0, '2370'],
        ['238030', 'APORTES A PENSIONES', 1, 0, '2380'],
        ['135515', 'RETENCION EN LA FUENTE (CLIENTES)', 1, 0, '1355'],
        ['135518', 'IMPUESTO DE INDUSTRIA Y COMERCIO RETENIDO (RETEICA)', 1, 0, '1355'],
        ['4175', 'DEVOLUCIONES, REBAJAS Y DESCUENTOS EN VENTAS', 1, 0, '41']
    ];
    
    db.exec("BEGIN TRANSACTION;");
    try {
        for (const [code, name, reqTercero, reqCc, parent] of criticalAccounts) {
            stmt.run(code, name, reqTercero, reqCc, parent);
        }
        db.exec("COMMIT;");
    } catch (e) {
        db.exec("ROLLBACK;");
        console.error("Failed to seed critical accounts:", e);
    }
}

function getTenantDb(tenantId) {
    if (!tenantId) throw new Error('Tenant ID is required');
    
    // Check global db if tenant exists
    const tenant = globalDb.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) {
        throw new Error(`Tenant '${tenantId}' does not exist.`);
    }

    if (tenantDbCache[tenantId]) {
        return tenantDbCache[tenantId];
    }

    const tenantDbPath = path.join(DATA_DIR, `tenant_${tenantId}.db`);
    const db = new DatabaseSync(tenantDbPath);
    
    // Enable WAL mode for concurrency
    db.exec("PRAGMA journal_mode = WAL;");

    // Initialize Tenant Database Schema
    db.exec(`
        -- Terceros
        CREATE TABLE IF NOT EXISTS terceros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo_identificacion TEXT NOT NULL, -- 'NIT', 'CC', 'CE', 'TI'
            identificacion TEXT UNIQUE NOT NULL,
            dv TEXT,
            nombre TEXT NOT NULL,
            apellidos TEXT,
            direccion TEXT,
            ciudad TEXT,
            telefono TEXT,
            email TEXT,
            tipo_cliente INTEGER DEFAULT 1, -- Boolean flags
            tipo_proveedor INTEGER DEFAULT 0,
            tipo_empleado INTEGER DEFAULT 0,
            aplica_rete_ica INTEGER DEFAULT 0,
            aplica_rete_fte INTEGER DEFAULT 0,
            tarifa_ica REAL DEFAULT 0,
            activo INTEGER DEFAULT 1
        );

        -- PUC (Plan Único de Cuentas)
        CREATE TABLE IF NOT EXISTS puc (
            codigo TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            requiere_tercero INTEGER DEFAULT 0,
            requiere_centro_costo INTEGER DEFAULT 0,
            activo INTEGER DEFAULT 1,
            parent_codigo TEXT
        );

        -- Centros de Costo
        CREATE TABLE IF NOT EXISTS centros_costo (
            codigo TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            activo INTEGER DEFAULT 1
        );

        -- Inventario
        CREATE TABLE IF NOT EXISTS inventario (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            descripcion TEXT NOT NULL,
            marca TEXT,
            compatibilidad TEXT,
            stock_actual REAL DEFAULT 0,
            stock_minimo REAL DEFAULT 0,
            precio_venta REAL DEFAULT 0,
            costo REAL DEFAULT 0,
            iva_tarifa REAL DEFAULT 19.0, -- Tarifa de IVA (0, 5, 19)
            activo INTEGER DEFAULT 1
        );

        -- Asientos Contables (Encabezados de transacciones)
        CREATE TABLE IF NOT EXISTS asientos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo_documento TEXT NOT NULL, -- 'FV' (Factura Venta), 'DS' (Doc Soporte), 'RC' (Recibo Caja), 'CE' (Comprobante Egreso), 'NC' (Nota Credito), 'ND' (Nota Debito), 'CC' (Cierre Caja)
            prefijo TEXT,
            numero INTEGER NOT NULL,
            fecha DATE NOT NULL,
            concepto TEXT,
            anulado INTEGER DEFAULT 0,
            creado_por TEXT NOT NULL,
            creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
            modificado_por TEXT,
            modificado_en DATETIME,
            
            -- DIAN Integration status
            dian_estado TEXT DEFAULT 'NO_APLICA', -- 'NO_APLICA', 'PENDIENTE', 'ENVIADO', 'RECHAZADO', 'CONTINGENCIA'
            dian_cufe TEXT,
            dian_xml_path TEXT,
            dian_response TEXT,
            dian_qr TEXT,
            
            -- Keep a record of the original totals for simple reporting
            total_documento REAL DEFAULT 0,
            ml_read INTEGER DEFAULT 0,
            
            UNIQUE(tipo_documento, prefijo, numero)
        );

        -- Detalles de Asientos Contables
        CREATE TABLE IF NOT EXISTS asiento_detalles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asiento_id INTEGER NOT NULL,
            cuenta_codigo TEXT NOT NULL,
            tercero_id INTEGER, -- Puede ser NULL si la cuenta no lo exige
            centro_costo_codigo TEXT, -- Puede ser NULL
            debito REAL DEFAULT 0,
            credito REAL DEFAULT 0,
            base_retencion REAL DEFAULT 0,
            porcentaje_retencion REAL DEFAULT 0,
            concepto_linea TEXT,
            FOREIGN KEY(asiento_id) REFERENCES asientos(id),
            FOREIGN KEY(cuenta_codigo) REFERENCES puc(codigo),
            FOREIGN KEY(tercero_id) REFERENCES terceros(id),
            FOREIGN KEY(centro_costo_codigo) REFERENCES centros_costo(codigo)
        );

        -- Reservas (Específico para el Club, pero se incluye en el esquema para uniformidad)
        CREATE TABLE IF NOT EXISTS reservas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER NOT NULL,
            fecha DATE NOT NULL,
            hora_inicio TEXT NOT NULL, -- 'HH:MM'
            hora_fin TEXT NOT NULL, -- 'HH:MM'
            recurso TEXT NOT NULL, -- 'Cancha Sintética', 'Salón de Eventos', etc.
            concepto TEXT,
            valor REAL DEFAULT 0,
            estado TEXT DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'CONFIRMADA', 'CANCELADA'
            creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(cliente_id) REFERENCES terceros(id)
        );

        -- Cierres de Caja Diarios
        CREATE TABLE IF NOT EXISTS cierres_caja (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha DATE NOT NULL,
            caja_codigo TEXT NOT NULL, -- 'CAJA_GENERAL', 'CAJA_TAQUILLA', etc.
            saldo_inicial REAL DEFAULT 0,
            ingresos REAL DEFAULT 0,
            egresos REAL DEFAULT 0,
            saldo_final REAL DEFAULT 0,
            cerrado_por TEXT NOT NULL,
            cerrado_en DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Auditoría local del tenant
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            username TEXT NOT NULL,
            documento_tipo TEXT,
            documento_numero TEXT,
            action TEXT NOT NULL, -- 'CREAR', 'ANULAR', 'MODIFICAR'
            details TEXT NOT NULL
        );
    `);

    // Insert default basic data if empty (PUC and Centros de Costo)
    const pucCount = db.prepare("SELECT COUNT(*) as count FROM puc").get().count;
    if (pucCount === 0) {
        // We will seed a minimal default PUC that will be overwritten or appended during migration
        const seedPuc = db.prepare(`
            INSERT INTO puc (codigo, nombre, requiere_tercero, requiere_centro_costo, parent_codigo)
            VALUES (?, ?, ?, ?, ?)
        `);
        seedPuc.run('1', 'ACTIVO', 0, 0, null);
        seedPuc.run('11', 'DISPONIBLE', 0, 0, '1');
        seedPuc.run('1105', 'CAJA', 0, 0, '11');
        seedPuc.run('110505', 'CAJA GENERAL', 0, 0, '1105');
        seedPuc.run('11050501', 'CAJA GENERAL TENANT', 1, 0, '110505'); // Cuentas auxiliares exigen tercero
        seedPuc.run('1110', 'BANCOS', 0, 0, '11');
        seedPuc.run('111005', 'MONEDA NACIONAL', 0, 0, '1110');
        seedPuc.run('11100508', 'BANCOLOMBIA', 1, 0, '111005');
        seedPuc.run('11100510', 'NEQUI', 1, 0, '111005');
        seedPuc.run('11100512', 'MERCADO PAGO', 1, 0, '111005');
        seedPuc.run('13', 'DEUDORES', 0, 0, '1');
        seedPuc.run('1305', 'CLIENTES', 0, 0, '13');
        seedPuc.run('130505', 'NACIONALES', 1, 0, '1305');
        seedPuc.run('13050501', 'CLIENTES NACIONALES', 1, 0, '130505');
        seedPuc.run('14', 'INVENTARIOS', 0, 0, '1');
        seedPuc.run('1435', 'MERCANCIAS NO FABRICADAS POR LA EMPRESA', 0, 0, '14');
        seedPuc.run('143501', 'AUTOPARTES / PRODUCTOS', 0, 0, '1435');
        seedPuc.run('2', 'PASIVO', 0, 0, null);
        seedPuc.run('22', 'PROVEEDORES', 0, 0, '2');
        seedPuc.run('2205', 'NACIONALES', 1, 0, '22');
        seedPuc.run('23', 'CUENTAS POR PAGAR', 0, 0, '2');
        seedPuc.run('2365', 'RETENCION EN LA FUENTE', 1, 0, '23');
        seedPuc.run('2368', 'IMPUESTO DE INDUSTRIA Y COMERCIO RETENIDO (RETEICA)', 1, 0, '23');
        seedPuc.run('24', 'IMPUESTOS, GRAVAMENES Y TASAS', 0, 0, '2');
        seedPuc.run('2408', 'IMPUESTO SOBRE LAS VENTAS POR PAGAR (IVA)', 1, 0, '24');
        seedPuc.run('3', 'PATRIMONIO', 0, 0, null);
        seedPuc.run('31', 'CAPITAL SOCIAL', 0, 0, '3');
        seedPuc.run('4', 'INGRESOS', 0, 0, null);
        seedPuc.run('41', 'OPERACIONALES', 0, 0, '4');
        seedPuc.run('4135', 'COMERCIO AL POR MAYOR Y AL POR MENOR', 0, 1, '41'); // Exige Centro de Costo
        seedPuc.run('413501', 'VENTAS GENERALES', 1, 1, '4135');
        seedPuc.run('5', 'GASTOS', 0, 0, null);
        seedPuc.run('51', 'OPERACIONALES DE ADMINISTRACION', 0, 0, '5');
        seedPuc.run('5135', 'SERVICIOS', 0, 1, '51');
        seedPuc.run('513535', 'TELEFONO', 1, 1, '5135');
        seedPuc.run('6', 'COSTO DE VENTAS', 0, 0, null);
        seedPuc.run('61', 'COSTO DE VENTAS Y DE PRESTACION DE SERVICIOS', 0, 0, '6');
        seedPuc.run('6135', 'COMERCIO AL POR MAYOR Y AL POR MENOR', 0, 1, '61');
        seedPuc.run('613501', 'COSTO AUTOPARTES / PRODUCTOS', 1, 1, '6135');
    }

    const ccCount = db.prepare("SELECT COUNT(*) as count FROM centros_costo").get().count;
    if (ccCount === 0) {
        const seedCc = db.prepare(`
            INSERT INTO centros_costo (codigo, nombre)
            VALUES (?, ?)
        `);
        if (tenantId === 'club') {
            seedCc.run('PISCINA', 'Operación Piscina');
            seedCc.run('FUTBOL', 'Cancha Sintética de Fútbol');
            seedCc.run('KIOSCO', 'Restaurante / Bar / Kiosco');
        } else {
            seedCc.run('LOCAL1', 'Local Principal Autopartes');
            seedCc.run('BOGOTA', 'Distribución Bogotá');
        }
    }

    ensureCriticalAccounts(db);

    // Migration: add sueldo column to terceros if not exists
    try {
        db.exec("ALTER TABLE terceros ADD COLUMN sueldo REAL DEFAULT 0;");
    } catch (e) {
        // Ignore, column already exists
    }

    // Migration: add ml_read column to asientos if not exists
    try {
        db.exec("ALTER TABLE asientos ADD COLUMN ml_read INTEGER DEFAULT 0;");
    } catch (e) {
        // Ignore, column already exists
    }

    // Migration: add inventario_id, cantidad, and precio_unitario to asiento_detalles
    try {
        db.exec("ALTER TABLE asiento_detalles ADD COLUMN inventario_id INTEGER;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE asiento_detalles ADD COLUMN cantidad REAL;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE asiento_detalles ADD COLUMN precio_unitario REAL;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN imagen_url TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN gtin TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN condicion TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN descripcion_detallada TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN warranty_type TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN warranty_time TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN modelo TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN numero_pieza TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN imagenes_adicionales TEXT;");
    } catch (e) {}

    // Cache the connection
    tenantDbCache[tenantId] = db;
    return db;
}

// Log actions in the database
function logAudit(tenantId, username, action, documentType, documentNumber, details) {
    try {
        const globalLog = globalDb.prepare(`
            INSERT INTO global_audit_logs (tenant_id, username, action, details)
            VALUES (?, ?, ?, ?)
        `);
        globalLog.run(tenantId, username, action, `${documentType || ''} ${documentNumber || ''}: ${details}`);

        if (tenantId) {
            const db = getTenantDb(tenantId);
            const tenantLog = db.prepare(`
                INSERT INTO audit_logs (username, documento_tipo, documento_numero, action, details)
                VALUES (?, ?, ?, ?, ?)
            `);
            tenantLog.run(username, documentType, String(documentNumber), action, details);
        }
    } catch (e) {
        console.error('Failed to write audit log:', e);
    }
}

// Helpers to sync data to WordPress/WooCommerce in the background
const https = require('node:https');
const { URL } = require('node:url');

function syncProductToWordPress(sku, stock, price, title = '') {
    try {
        const wordpressUrl = "https://repuestoscajica.com";
        const apiUrl = `${wordpressUrl}/wp-json/patucarro-sync/v1/sync-product`;
        const payload = JSON.stringify({ sku, stock, price, title });

        const parsedUrl = new URL(apiUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization': 'Bearer Patucarro2026*'
            },
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`[WP Product Sync] SKU ${sku} status: ${res.statusCode}`);
            });
        });

        req.on('error', (e) => {
            console.error(`[WP Product Sync] SKU ${sku} error:`, e.message);
        });

        req.write(payload);
        req.end();
    } catch (err) {
        console.error(`[WP Product Sync Exception] SKU ${sku}:`, err.message);
    }
}

function syncCustomerToWordPress(tercero) {
    try {
        const wordpressUrl = "https://repuestoscajica.com";
        const apiUrl = `${wordpressUrl}/wp-json/patucarro-sync/v1/sync-customer`;
        const payload = JSON.stringify({
            email: tercero.email,
            nombre: tercero.nombre,
            apellidos: tercero.apellidos || '',
            telefono: tercero.telefono || '',
            direccion: tercero.direccion || '',
            ciudad: tercero.ciudad || '',
            identificacion: tercero.identificacion
        });

        const parsedUrl = new URL(apiUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization': 'Bearer Patucarro2026*'
            },
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`[WP Customer Sync] NIT ${tercero.identificacion} status: ${res.statusCode}`);
            });
        });

        req.on('error', (e) => {
            console.error(`[WP Customer Sync] NIT ${tercero.identificacion} error:`, e.message);
        });

        req.write(payload);
        req.end();
    } catch (err) {
        console.error(`[WP Customer Sync Exception] NIT ${tercero.identificacion}:`, err.message);
    }
}

module.exports = {
    globalDb,
    getTenantDb,
    logAudit,
    syncProductToWordPress,
    syncCustomerToWordPress
};
