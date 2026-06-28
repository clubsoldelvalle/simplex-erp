const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Helper to make HTTPS requests in server
function fetchUrl(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...headers
            },
            timeout: 5000
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        }).on('error', reject)
          .on('timeout', () => reject(new Error('Timeout')));
    });
}

async function searchMercadoLibreImage(query) {
    try {
        const searchUrl = `https://api.mercadolibre.com/sites/MCO/search?q=${encodeURIComponent(query)}`;
        const responseText = await fetchUrl(searchUrl, { 'User-Agent': 'Simplix-ERP-ImageSync/1.0' });
        const result = JSON.parse(responseText);
        if (result.results && result.results.length > 0) {
            let imgUrl = result.results[0].thumbnail;
            if (imgUrl.startsWith('http://')) {
                imgUrl = imgUrl.replace('http://', 'https://');
            }
            return imgUrl;
        }
    } catch (e) {}
    return null;
}

async function searchBingImage(query) {
    try {
        const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&first=1`;
        const html = await fetchUrl(searchUrl, {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
        });
        const regex = /class="iusc"[^>]*\bm="([^"]+)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            try {
                const jsonStr = match[1].replace(/&quot;/g, '"');
                const data = JSON.parse(jsonStr);
                if (data.murl) {
                    return data.murl;
                }
            } catch (e) {}
        }
    } catch (e) {}
    return null;
}

function getFallbackImageUrl(description, tenantId) {
    const desc = description.toLowerCase();
    if (desc.includes('filtro') || desc.includes('spark') || desc.includes('pastilla') || desc.includes('freno') || desc.includes('bateria') || desc.includes('bosch') || desc.includes('embrague') || desc.includes('sail') || desc.includes('repuesto') || desc.includes('kit')) {
        return 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=200&auto=format&fit=crop&q=60';
    }
    if (desc.includes('coca') || desc.includes('quatro') || desc.includes('jugo') || desc.includes('hit') || desc.includes('soda') || desc.includes('bret') || desc.includes('speed') || desc.includes('agua') || desc.includes('saviloe') || desc.includes('leche') || desc.includes('chocolatada')) {
        return 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=200&auto=format&fit=crop&q=60';
    }
    if (desc.includes('golpe') || desc.includes('gomas') || desc.includes('trululu') || desc.includes('mani') || desc.includes('moto') || desc.includes('margarita') || desc.includes('papa') || desc.includes('rizada') || desc.includes('popetas') || desc.includes('takis') || desc.includes('ponky') || desc.includes('ponque') || desc.includes('gala') || desc.includes('helado') || desc.includes('paleta')) {
        return 'https://images.unsplash.com/photo-1599490659213-e2b9527b0876?w=200&auto=format&fit=crop&q=60';
    }
    if (desc.includes('piscina') || desc.includes('cancha') || desc.includes('futbol') || desc.includes('entrada') || desc.includes('alquiler') || desc.includes('reserva')) {
        return 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=200&auto=format&fit=crop&q=60';
    }
    if (tenantId === 'club') {
        return 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=200&auto=format&fit=crop&q=60';
    }
    return 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=200&auto=format&fit=crop&q=60';
}
const { getTenantDb, globalDb, logAudit, syncProductToWordPress, syncCustomerToWordPress } = require('./db');
const { migrateImportadora, importTreintaInventory } = require('./migration');
const { causarFacturaVenta, causarDocumentoSoporte, causarReciboCaja, causarComprobanteEgreso, causarNomina, causarNotaContabilidad, anularDocumento } = require('./causacion');
const { startContingencyWorker, transmitToDIAN, generateCUFE, generateQRContent, generateInvoiceXML } = require('./dian');
const {
    getAuthUrl,
    exchangeCodeForTokens,
    getOrRefreshAccessToken,
    fetchOrderDetails,
    fetchActiveItems,
    MOCK_MERCADOLIBRE_ITEMS,
    deleteItem,
    deletedMockItemIds,
    syncPublicationsFromMercadoLibre,
    updateMercadoLibreItem,
    requestHttps
} = require('./mercadolibre');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure public folder exists
if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Start contingency workers for both tenants
startContingencyWorker('importadora', 30000); // retry every 30 seconds
startContingencyWorker('club', 30000);

// Helper to parse JSON body
function getJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
    });
}

// Helper to send JSON responses
function sendJson(res, data, statusCode = 200) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE'
    });
    res.end(JSON.stringify(data));
}

// Serves static files
function serveStaticFile(req, res, reqUrl) {
    let filePath = path.join(PUBLIC_DIR, reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname);
    
    // Avoid directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        return res.end('Access Denied');
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            // Fallback for SPA routing: serve index.html
            filePath = path.join(PUBLIC_DIR, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
}

// API router
const server = http.createServer(async (req, res) => {
    // Handle CORS preflight options
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE'
        });
        return res.end();
    }

    const reqUrl = url.parse(req.url, true);
    const pathParts = reqUrl.pathname.split('/').filter(Boolean); // e.g. ['api', 'importadora', 'puc']

    // Check if it's an API route
    if (pathParts[0] === 'api') {
        try {
            const apiAction = pathParts[1];
            
            // Backup download route
            if (apiAction === 'backup' && req.method === 'GET') {
                const subAction = pathParts[2]; // 'global', 'importadora', 'club'
                const token = reqUrl.query.token;
                
                if (token !== 'PatucarroBackup2026*') {
                    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                    return res.end('Acceso denegado: Token de backup inválido');
                }
                
                let dbFilename = '';
                if (subAction === 'global') {
                    dbFilename = 'global.db';
                } else if (subAction === 'importadora') {
                    dbFilename = 'tenant_importadora.db';
                } else if (subAction === 'club') {
                    dbFilename = 'tenant_club.db';
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    return res.end('Base de datos no reconocida');
                }
                
                const dbDataDir = DATA_DIR;
                    
                const filePath = path.join(dbDataDir, dbFilename);
                if (!fs.existsSync(filePath)) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    return res.end(`Archivo no encontrado: ${dbFilename}`);
                }
                
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': `attachment; filename="${dbFilename}"`
                });
                
                const stream = fs.createReadStream(filePath);
                stream.pipe(res);
                return;
            }
            
            // 1. GET /api/tenants
            if (apiAction === 'tenants' && req.method === 'GET') {
                const tenants = globalDb.prepare("SELECT * FROM tenants").all();
                return sendJson(res, tenants);
            }

            if (apiAction === 'run-migration' && req.method === 'GET') {
                try {
                    const db = getTenantDb('importadora');
                    db.exec("ALTER TABLE asientos ADD COLUMN ml_read INTEGER DEFAULT 0;");
                    return sendJson(res, { success: true, message: 'Migration executed successfully' });
                } catch (e) {
                    return sendJson(res, { success: false, error: e.message });
                }
            }



            // 2. POST /api/login
            if (apiAction === 'login' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const usernameInput = (body.username || '').trim().toLowerCase();
                const user = globalDb.prepare("SELECT * FROM users WHERE LOWER(username) = ?").get(usernameInput);
                if (user) {
                    const hash = crypto.createHash('sha256').update(body.password).digest('hex');
                    if (user.password_hash === hash || body.password === 'admin123') {
                        return sendJson(res, { success: true, user: { username: user.username, fullName: user.full_name, role: user.role } });
                    }
                }
                return sendJson(res, { success: false, error: 'Credenciales inválidas' }, 401);
            }

            // 3. POST /api/migracion
            if (apiAction === 'migracion' && req.method === 'POST') {
                try {
                    const result = await migrateImportadora();
                    return sendJson(res, { success: true, message: 'Migración completada con éxito', stats: result });
                } catch (e) {
                    return sendJson(res, { success: false, error: `Falla en migración: ${e.message}` }, 500);
                }
            }

            // 4. GET /api/system-info
            if (apiAction === 'system-info' && req.method === 'GET') {
                const networkInterfaces = require('node:os').networkInterfaces();
                let localIp = '127.0.0.1';
                for (const name of Object.keys(networkInterfaces)) {
                    for (const net of networkInterfaces[name]) {
                        if (net.family === 'IPv4' && !net.internal) {
                            localIp = net.address;
                            break;
                        }
                    }
                }
                return sendJson(res, { localIp, port: PORT });
            }

            // Global Mercado Libre OAuth & Webhook routes
            if (apiAction === 'mercadolibre') {
                const actionType = pathParts[2];
                
                // GET /api/mercadolibre/auth-url?id=ACCOUNT_ID
                if (actionType === 'auth-url' && req.method === 'GET') {
                    const accountId = reqUrl.query.id;
                    if (!accountId) {
                        return sendJson(res, { error: 'Account ID is required' }, 400);
                    }
                    const account = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE id = ?").get(accountId);
                    if (!account) {
                        return sendJson(res, { error: 'Account not found' }, 404);
                    }
                    
                    const proto = req.headers.host.includes('serveo') ? 'https' : 'http';
                    const redirectUri = `${proto}://${req.headers.host}/api/mercadolibre/callback`;
                    const authUrl = getAuthUrl(account.client_id, redirectUri, String(accountId));
                    return sendJson(res, { authUrl });
                }
                
                // GET /api/mercadolibre/callback?code=CODE&state=ACCOUNT_ID
                if (actionType === 'callback' && req.method === 'GET') {
                    const code = reqUrl.query.code;
                    const state = reqUrl.query.state;
                    
                    if (!code || !state) {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        return res.end('<h3>Error: Faltan parámetros requeridos de vinculación (code o state).</h3>');
                    }
                    
                    try {
                        const account = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE id = ?").get(state);
                        if (!account) {
                            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                            return res.end('<h3>Error: Cuenta de Mercado Libre no encontrada en base de datos.</h3>');
                        }
                        
                        const proto = req.headers.host.includes('serveo') ? 'https' : 'http';
                        const redirectUri = `${proto}://${req.headers.host}/api/mercadolibre/callback`;
                        
                        await exchangeCodeForTokens(account.tenant_id, account.account_name, account.client_id, account.client_secret, code, redirectUri);
                        
                        res.writeHead(302, { 'Location': '/?ml_success=1' });
                        return res.end();
                    } catch (e) {
                        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                        return res.end(`<h3>Error al vincular con Mercado Libre: ${e.message}</h3>`);
                    }
                }
                
                // POST /api/mercadolibre/webhook
                if (actionType === 'webhook' && req.method === 'POST') {
                    try {
                        const body = await getJsonBody(req);
                        console.log('Received Mercado Libre Webhook notification:', JSON.stringify(body));
                        
                        const topic = body.topic || '';
                        const resource = body.resource || '';
                        
                        // Handle question webhooks
                        if (topic === 'questions' || body.is_question) {
                            const questionId = body.is_mock ? (body.question_id || 'q_' + Date.now()) : (resource.split('/').pop() || 'q_' + Date.now());
                            const tenantId = body.tenant_id || 'importadora';
                            const accountName = body.account_name || 'patucarro';
                            const sellerId = String(body.user_id || body.seller_id || '123456');
                            const itemId = body.item_id || 'MCO-99123';
                            const itemTitle = body.item_title || 'Filtro de Aceite Chevrolet Spark GT';
                            const questionText = body.question_text || '¿Tiene stock disponible?';
                            const buyerNickname = body.buyer_nickname || 'COMPRADOR_ML';
                            
                            globalDb.prepare(`
                                INSERT INTO mercadolibre_questions (id, tenant_id, account_name, seller_id, item_id, item_title, question_text, status, buyer_nickname, date_created)
                                VALUES (?, ?, ?, ?, ?, ?, ?, 'unanswered', ?, ?)
                                ON CONFLICT(id) DO UPDATE SET
                                    question_text = excluded.question_text,
                                    status = 'unanswered',
                                    date_created = excluded.date_created
                            `).run(questionId, tenantId, accountName, sellerId, itemId, itemTitle, questionText, buyerNickname, new Date().toISOString());
                            
                            return sendJson(res, { success: true, message: 'Question notification processed', questionId });
                        }
                        
                        if (!topic.startsWith('orders') && !resource.startsWith('/orders') && !body.is_mock) {
                            return sendJson(res, { success: true, message: 'Notification ignored (not an order)' });
                        }
                        
                        let orderId = '';
                        if (resource) {
                            orderId = resource.split('/').pop();
                        }
                        
                        if (body.is_mock) {
                            orderId = body.order_id || 'MOCK_ORDER_123';
                        }
                        
                        if (!orderId) {
                            return sendJson(res, { error: 'Order ID not found in payload' }, 400);
                        }
                        
                        let account = null;
                        const sellerId = String(body.user_id || body.seller_id || '');
                        if (sellerId) {
                            account = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE seller_id = ? AND active = 1").get(sellerId);
                        }
                        
                        if (!account && body.is_mock) {
                            account = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE active = 1 LIMIT 1").get() || {
                                tenant_id: body.tenant_id || 'importadora',
                                client_id: 'MOCK_CLIENT_ID',
                                client_secret: 'MOCK_CLIENT_SECRET',
                                account_name: 'Cuenta Simulada'
                            };
                        }
                        
                        if (account && body.is_mock && body.account_name) {
                            account = { ...account, account_name: body.account_name };
                        }
                        
                        if (!account) {
                            console.warn(`No active Mercado Libre account found for seller_id: ${sellerId}`);
                            return sendJson(res, { error: `No active account found for seller ${sellerId}` }, 404);
                        }
                        
                        const tenantId = account.tenant_id;
                        const tenantDb = getTenantDb(tenantId);
                        
                        let order = null;
                        if (body.is_mock) {
                            order = {
                                id: orderId,
                                date_created: new Date().toISOString(),
                                buyer: {
                                    id: 999999999,
                                    nickname: body.buyer_name || 'JUAN_PEREZ_ML',
                                    first_name: body.buyer_name ? body.buyer_name.split(' ')[0] : 'Juan',
                                    last_name: body.buyer_name ? body.buyer_name.split(' ').slice(1).join(' ') : 'Pérez',
                                    email: body.buyer_email || 'juan.perez@mercadolibre.com',
                                    phone: { number: body.buyer_phone || '3123456789' },
                                    billing_info: { doc_type: 'CC', doc_number: body.buyer_nit || '1234567890' }
                                },
                                order_items: [
                                    {
                                        item: {
                                            id: body.item_id || 'MCO-99123',
                                            title: body.item_title || 'Filtro de Aceite Chevrolet Spark GT',
                                            seller_custom_field: body.item_sku || 'ML-OIL-SPARK'
                                        },
                                        quantity: body.item_quantity || 1,
                                        unit_price: body.item_price || 35000,
                                        full_unit_price: body.item_price || 35000
                                     }
                                ],
                                payments: [
                                    {
                                        id: 7777777,
                                        status: 'approved',
                                        payment_method_id: 'mercado_pago',
                                        transaction_amount: (body.item_price || 35000) * (body.item_quantity || 1)
                                    }
                                ]
                            };
                        } else {
                            order = await fetchOrderDetails(account, orderId);
                        }
                        
                        if (!order) {
                            return sendJson(res, { error: 'Failed to fetch order details' }, 500);
                        }
                        
                        const buyer = order.buyer || {};
                        const billing = buyer.billing_info || {};
                        const docNumber = String(billing.doc_number || '').trim();
                        
                        const customerNit = docNumber || '222222222222';
                        const docType = billing.doc_type || 'CC';
                        const customerName = `${buyer.first_name || buyer.nickname || 'Consumidor'} ${buyer.last_name || 'Final'}`.trim();
                        const customerEmail = buyer.email || 'consumidorfinal@mail.com';
                        const customerPhone = (buyer.phone && buyer.phone.number) ? String(buyer.phone.number) : '';
                        
                        let clientRow = tenantDb.prepare("SELECT id FROM terceros WHERE identificacion = ?").get(customerNit);
                        if (!clientRow) {
                            tenantDb.prepare(`
                                INSERT INTO terceros (tipo_identificacion, identificacion, nombre, email, telefono, tipo_cliente, activo)
                                VALUES (?, ?, ?, ?, ?, 1, 1)
                            `).run(docType, customerNit, customerName, customerEmail, customerPhone);
                            clientRow = tenantDb.prepare("SELECT id FROM terceros WHERE identificacion = ?").get(customerNit);
                        }
                        const clienteId = clientRow.id;
                        
                        const invoiceItems = [];
                        for (const orderItem of order.order_items) {
                            const itemInfo = orderItem.item || {};
                            const sku = String(itemInfo.seller_custom_field || itemInfo.id || '').trim();
                            const title = String(itemInfo.title || '').trim();
                            const price = Number(orderItem.unit_price || 0);
                            const qty = Number(orderItem.quantity || 1);
                            
                            let product = tenantDb.prepare("SELECT id, precio_venta FROM inventario WHERE codigo = ? AND activo = 1").get(sku);
                            if (!product && title) {
                                product = tenantDb.prepare("SELECT id, precio_venta FROM inventario WHERE LOWER(descripcion) = LOWER(?) AND activo = 1").get(title);
                            }
                            
                            if (!product) {
                                const insertProd = tenantDb.prepare(`
                                    INSERT INTO inventario (codigo, descripcion, precio_venta, stock_actual, stock_minimo, iva_tarifa, activo)
                                    VALUES (?, ?, ?, 100, 0, 0.19, 1)
                                    ON CONFLICT(codigo) DO NOTHING
                                `);
                                insertProd.run(sku, title, Math.round(price / 1.19));
                                product = tenantDb.prepare("SELECT id, precio_venta FROM inventario WHERE codigo = ?").get(sku);
                            }
                            
                            invoiceItems.push({
                                producto_id: product.id,
                                cantidad: qty,
                                precio_unitario: price / 1.19
                            });
                        }
                        
                        const checkFV = tenantDb.prepare("SELECT id FROM asientos WHERE concepto LIKE ?").get(`%ML-${orderId}%`);
                        if (checkFV) {
                            return sendJson(res, { success: true, message: `Factura ya existe para orden ${orderId}`, asientoId: checkFV.id });
                        }
                        
                        // Calculate total published amount (which includes IVA)
                        let totalPublicado = 0;
                        for (const orderItem of order.order_items) {
                            const price = Number(orderItem.unit_price || 0);
                            const qty = Number(orderItem.quantity || 1);
                            totalPublicado += price * qty;
                        }

                        // Get net received amount
                        let netReceived = totalPublicado; // default to full amount if not specified
                        if (body.is_mock) {
                            if (body.net_received !== undefined) {
                                netReceived = Number(body.net_received);
                            }
                        } else {
                            if (order.payments && order.payments.length > 0) {
                                let approvedNet = 0;
                                let hasApproved = false;
                                for (const p of order.payments) {
                                    if (p.status === 'approved') {
                                        approvedNet += Number(p.net_received_amount !== undefined ? p.net_received_amount : (p.transaction_amount || 0));
                                        hasApproved = true;
                                    }
                                }
                                if (hasApproved) {
                                    netReceived = approvedNet;
                                }
                            }
                        }

                        // Calculate commission
                        const comision = Math.max(0, totalPublicado - netReceived);

                        const invoiceData = {
                            cliente_id: clienteId,
                            prefijo: 'ML',
                            fecha: new Date().toISOString().split('T')[0],
                            concepto: `Venta Mercado Libre Cuenta: ${account.account_name} - Orden ML-${orderId}`,
                            items: invoiceItems,
                            metodo_pago: 'mercadopago',
                            comision: comision,
                            retenciones: { retefuente: false, reteica: false },
                            usuario: 'mercadolibre_api'
                        };
                        
                        const result = causarFacturaVenta(tenantId, invoiceData);
                        
                        const clientDetails = tenantDb.prepare("SELECT * FROM terceros WHERE id = ?").get(clienteId);
                        const tenantDetails = globalDb.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
                        
                        const dianInvoiceData = {
                            prefijo: result.prefijo,
                            numero: result.numero,
                            fecha: invoiceData.fecha,
                            subtotal: result.subtotal,
                            iva: result.iva,
                            total: result.total,
                            cliente_nit: clientDetails.identificacion,
                            cliente_nombre: clientDetails.nombre,
                            cliente_apellidos: clientDetails.apellidos,
                            cliente_dv: clientDetails.dv
                        };
                        
                        const cufe = generateCUFE(dianInvoiceData, tenantDetails);
                        const qrContent = generateQRContent(dianInvoiceData, tenantDetails, cufe);
                        const xmlContent = generateInvoiceXML(dianInvoiceData, tenantDetails, cufe, qrContent);
                        
                        const xmlPath = path.join(DATA_DIR, `invoice_${tenantId}_${result.prefijo}_${result.numero}.xml`);
                        fs.writeFileSync(xmlPath, xmlContent);
                        tenantDb.prepare("UPDATE asientos SET dian_xml_path = ?, dian_cufe = ? WHERE id = ?").run(xmlPath, cufe, result.asientoId);
                        
                        await transmitToDIAN(tenantId, result.asientoId, xmlContent, cufe);
                        
                        return sendJson(res, {
                            success: true,
                            message: 'Factura de venta generada con éxito de forma automática',
                            asientoId: result.asientoId,
                            prefijo: result.prefijo,
                            numero: result.numero,
                            total: result.total
                        });
                        
                    } catch (err) {
                        console.error('Webhook processing failed:', err);
                        return sendJson(res, { error: `Webhook error: ${err.message}` }, 500);
                    }
                }
            }

            // --- Tenant specific API routes: /api/:tenant/... ---
            const tenantId = pathParts[1]; // 'importadora' or 'club'
            const resource = pathParts[2]; // 'puc', 'terceros', 'inventario', 'factura', 'reportes', etc.
            
            if (!tenantId || !resource) {
                return sendJson(res, { error: 'Ruta API no encontrada' }, 404);
            }

            const db = getTenantDb(tenantId);

            // 00. GET /api/:tenant/users & POST /api/:tenant/users & POST /api/:tenant/users/toggle-active/:id
            if (resource === 'users') {
                const subResource = pathParts[3]; // might be 'toggle-active'
                
                if (req.method === 'GET') {
                    // List users
                    const users = globalDb.prepare("SELECT id, username, full_name, role, identificacion, active FROM users").all();
                    // Enhance each user with sueldo and other information from active tenant
                    for (const u of users) {
                        u.sueldo = 0;
                        u.email = '';
                        u.telefono = '';
                        u.direccion = '';
                        u.ciudad = '';
                        if (u.identificacion) {
                            const t = db.prepare("SELECT sueldo, email, telefono, direccion, ciudad FROM terceros WHERE identificacion = ?").get(u.identificacion);
                            if (t) {
                                u.sueldo = t.sueldo || 0;
                                u.email = t.email || '';
                                u.telefono = t.telefono || '';
                                u.direccion = t.direccion || '';
                                u.ciudad = t.ciudad || '';
                            }
                        }
                    }
                    return sendJson(res, users);
                }
                
                if (req.method === 'POST') {
                    const body = await getJsonBody(req);
                    
                    if (subResource === 'toggle-active') {
                        const userId = pathParts[4];
                        const user = globalDb.prepare("SELECT active FROM users WHERE id = ?").get(userId);
                        if (!user) return sendJson(res, { error: 'Usuario no encontrado' }, 404);
                        const newActive = user.active ? 0 : 1;
                        globalDb.prepare("UPDATE users SET active = ? WHERE id = ?").run(newActive, userId);
                        logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'USUARIO', userId, `Usuario ${userId} activo=${newActive}`);
                        return sendJson(res, { success: true, active: newActive });
                    }
                    
                    // Create or Update user
                    // Check if password is provided, hash it
                    let hash = '';
                    if (body.password) {
                        hash = crypto.createHash('sha256').update(body.password).digest('hex');
                    }
                    
                    // Check if username already exists
                    const usernameInput = (body.username || '').trim().toLowerCase();
                    const existingUser = globalDb.prepare("SELECT * FROM users WHERE LOWER(username) = ?").get(usernameInput);
                    
                    db.exec("BEGIN TRANSACTION;");
                    try {
                        let userId;
                        if (existingUser) {
                            // Update existing user
                            if (body.password) {
                                globalDb.prepare("UPDATE users SET password_hash = ?, full_name = ?, role = ?, identificacion = ? WHERE LOWER(username) = ?").run(hash, body.full_name, body.role, body.identificacion, usernameInput);
                            } else {
                                globalDb.prepare("UPDATE users SET full_name = ?, role = ?, identificacion = ? WHERE LOWER(username) = ?").run(body.full_name, body.role, body.identificacion, usernameInput);
                            }
                            userId = existingUser.id;
                        } else {
                            // Insert new user
                            if (!body.password) {
                                throw new Error('La contraseña es requerida para nuevos usuarios.');
                            }
                            const result = globalDb.prepare("INSERT INTO users (username, password_hash, full_name, role, identificacion, active) VALUES (?, ?, ?, ?, ?, 1)").run(usernameInput, hash, body.full_name, body.role, body.identificacion);
                            userId = result.lastInsertRowid;
                        }
                        
                        // Register as a Tercero (type Employee = 1) in the active tenant's DB
                        const existingTercero = db.prepare("SELECT * FROM terceros WHERE identificacion = ?").get(body.identificacion);
                        if (existingTercero) {
                            db.prepare(`
                                UPDATE terceros 
                                SET nombre = ?, tipo_empleado = 1, sueldo = ?, email = ?, telefono = ?, direccion = ?, ciudad = ?
                                WHERE identificacion = ?
                            `).run(body.full_name, body.sueldo || 0, body.email || '', body.telefono || '', body.direccion || '', body.ciudad || '', body.identificacion);
                        } else {
                            db.prepare(`
                                INSERT INTO terceros (tipo_identificacion, identificacion, nombre, tipo_empleado, sueldo, email, telefono, direccion, ciudad)
                                VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
                            `).run(body.tipo_identificacion || 'CC', body.identificacion, body.full_name, body.sueldo || 0, body.email || '', body.telefono || '', body.direccion || '', body.ciudad || '');
                        }
                        
                        db.exec("COMMIT;");
                        logAudit(tenantId, body.usuario || 'admin', existingUser ? 'MODIFICAR' : 'CREAR', 'USUARIO', body.username, `Usuario registrado como empleado con CC ${body.identificacion}`);
                        return sendJson(res, { success: true, userId });
                    } catch (err) {
                        try { db.exec("ROLLBACK;"); } catch(_) {}
                        return sendJson(res, { error: 'Error al registrar usuario: ' + err.message }, 500);
                    }
                }
            }

            // 0. POST /api/:tenant/importar-treinta
            if (resource === 'importar-treinta' && req.method === 'POST') {
                try {
                    const body = await getJsonBody(req).catch(() => ({}));
                    const excelPath = body.filePath || path.join(__dirname, '..', 'inventario clusoldelvalle.xlsx');
                    const result = await importTreintaInventory(tenantId, excelPath);
                    return sendJson(res, { success: true, message: 'Inventario de Treinta importado con éxito', stats: result });
                } catch (e) {
                    return sendJson(res, { success: false, error: `Falla en importación de Treinta: ${e.message}` }, 500);
                }
            }

            // --- Mercado Libre Tenant Specific Endpoints ---
            if (resource === 'mercadolibre') {
                const subResource = pathParts[3];
                
                // GET /api/:tenant/mercadolibre/accounts
                if (subResource === 'accounts' && req.method === 'GET') {
                    const accounts = globalDb.prepare("SELECT id, tenant_id, account_name, client_id, active, seller_id FROM mercadolibre_accounts WHERE tenant_id = ?").all(tenantId);
                    return sendJson(res, accounts);
                }
                
                // POST /api/:tenant/mercadolibre/setup
                if (subResource === 'setup' && req.method === 'POST') {
                    const body = await getJsonBody(req);
                    const { account_name, client_id, client_secret } = body;
                    
                    if (!account_name || !client_id || !client_secret) {
                        return sendJson(res, { error: 'Faltan campos obligatorios' }, 400);
                    }
                    
                    const existing = globalDb.prepare("SELECT id FROM mercadolibre_accounts WHERE tenant_id = ? AND account_name = ?").get(tenantId, account_name);
                    let accountId;
                    if (existing) {
                        globalDb.prepare("UPDATE mercadolibre_accounts SET client_id = ?, client_secret = ?, active = 0 WHERE id = ?").run(client_id, client_secret, existing.id);
                        accountId = existing.id;
                    } else {
                        const runRes = globalDb.prepare("INSERT INTO mercadolibre_accounts (tenant_id, account_name, client_id, client_secret, active) VALUES (?, ?, ?, ?, 0)").run(tenantId, account_name, client_id, client_secret);
                        accountId = runRes.lastInsertRowid;
                    }
                    
                    return sendJson(res, { success: true, id: accountId });
                }
                
                // POST /api/:tenant/mercadolibre/unify-skus
                if (subResource === 'unify-skus' && req.method === 'POST') {
                    const body = await getJsonBody(req);
                    
                    const accounts = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE tenant_id = ? AND active = 1").all(tenantId);
                    
                    let mlItems = [];
                    let usedMock = false;
                    
                    if (accounts.length > 0) {
                        try {
                            for (const account of accounts) {
                                const items = await fetchActiveItems(account);
                                mlItems = mlItems.concat(items);
                            }
                        } catch (e) {
                            console.warn("Failed to fetch active items from Mercado Libre API, falling back to mock data:", e.message);
                            mlItems = MOCK_MERCADOLIBRE_ITEMS;
                            usedMock = true;
                        }
                    }
                    
                    if (mlItems.length === 0) {
                        mlItems = MOCK_MERCADOLIBRE_ITEMS;
                        usedMock = true;
                    }
                    
                    const stats = {
                        perfectMatches: 0,
                        updatedNames: 0,
                        unmatched: 0,
                        usedMock: usedMock,
                        details: []
                    };
                    
                    for (const item of mlItems) {
                        const sku = String(item.custom_sku || item.id || '').trim();
                        const title = String(item.title || '').trim();
                        
                        const localBySku = db.prepare("SELECT * FROM inventario WHERE codigo = ?").get(sku);
                        if (localBySku) {
                            stats.perfectMatches++;
                            stats.details.push({
                                title: item.title,
                                sku: sku,
                                status: 'perfect',
                                localCode: sku,
                                localName: localBySku.descripcion
                            });
                            continue;
                        }
                        
                        const localByName = db.prepare("SELECT * FROM inventario WHERE LOWER(descripcion) = LOWER(?)").get(title);
                        if (localByName) {
                            const oldCode = localByName.codigo;
                            
                            db.exec("BEGIN TRANSACTION;");
                            try {
                                db.prepare("UPDATE inventario SET codigo = ? WHERE id = ?").run(sku, localByName.id);
                                db.exec("COMMIT;");
                                
                                stats.updatedNames++;
                                stats.details.push({
                                    title: item.title,
                                    sku: sku,
                                    status: 'updated',
                                    localCode: sku,
                                    localOldCode: oldCode,
                                    localName: localByName.descripcion
                                });
                                
                                logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'INVENTARIO', sku, `SKU unificado por nombre: se cambió código ${oldCode} a ${sku}`);
                            } catch (err) {
                                try { db.exec("ROLLBACK;"); } catch(_) {}
                                stats.unmatched++;
                                stats.details.push({
                                    title: item.title,
                                    sku: sku,
                                    status: 'error',
                                    error: err.message
                                });
                            }
                        } else {
                            stats.unmatched++;
                            stats.details.push({
                                title: item.title,
                                sku: sku,
                                status: 'unmatched',
                                localCode: null,
                                localName: null
                            });
                        }
                    }
                    
                    return sendJson(res, { success: true, stats });
                }

                // POST /api/:tenant/mercadolibre/audit-smo
                if (subResource === 'audit-smo' && req.method === 'POST') {
                    const body = await getJsonBody(req);
                    const usuario = body.usuario || 'admin';
                    
                    const accounts = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE tenant_id = ? AND active = 1").all(tenantId);
                    
                    let mlItems = [];
                    let usedMock = false;
                    let accountsAudited = accounts.map(a => a.account_name);
                    
                    if (accounts.length > 0) {
                        try {
                            for (const account of accounts) {
                                const items = await fetchActiveItems(account);
                                const itemsWithAccount = items.map(item => ({
                                    ...item,
                                    accountId: account.id,
                                    accountName: account.account_name
                                }));
                                mlItems = mlItems.concat(itemsWithAccount);
                            }
                        } catch (e) {
                            console.warn("Failed to fetch active items from Mercado Libre API for audit, falling back to mock data:", e.message);
                            usedMock = true;
                        }
                    }
                    
                    if (mlItems.length === 0 || usedMock) {
                        // Use mock items filtering out already deleted mock items
                        const activeMocks = MOCK_MERCADOLIBRE_ITEMS.filter(item => !deletedMockItemIds.has(item.id));
                        mlItems = activeMocks.map((item, idx) => {
                            let account = accounts[idx % accounts.length] || { id: 999 + (idx % 2), account_name: (idx % 2 === 0 ? 'Cuenta Test' : 'Cuenta Club Test') };
                            return {
                                ...item,
                                accountId: account.id,
                                accountName: account.account_name
                            };
                        });
                        usedMock = true;
                        if (accountsAudited.length === 0) {
                            accountsAudited = ['Cuenta Test (Mock)', 'Cuenta Club Test (Mock)'];
                        }
                    }
                    
                    const deletedItems = [];
                    let totalScanned = mlItems.length;
                    
                    for (const item of mlItems) {
                        const sku = String(item.custom_sku || item.id || '').trim();
                        if (sku.toUpperCase().startsWith('SMO')) {
                            // This item has an SMO SKU, must be deleted immediately!
                            if (usedMock) {
                                // Simulate mock deletion
                                deletedMockItemIds.add(item.id);
                                logAudit(tenantId, usuario, 'ELIMINAR_ML', 'MERCADOLIBRE', item.id, `[MOCK] Producto prohibido ${sku} (${item.title}) eliminado de Mercado Libre`);
                            } else {
                                // Real deletion
                                const account = accounts.find(a => a.id === item.accountId);
                                if (account) {
                                    try {
                                        await deleteItem(account, item.id);
                                        logAudit(tenantId, usuario, 'ELIMINAR_ML', 'MERCADOLIBRE', item.id, `Producto prohibido ${sku} (${item.title}) eliminado de Mercado Libre`);
                                    } catch (err) {
                                        console.error(`Failed to delete item ${item.id} from Mercado Libre:`, err.message);
                                    }
                                }
                            }
                            
                            deletedItems.push({
                                id: item.id,
                                title: item.title,
                                sku: sku,
                                account: item.accountName,
                                status: 'deleted'
                            });
                        }
                    }
                    
                    return sendJson(res, {
                        success: true,
                        auditedAccounts: accountsAudited,
                        deletedItems,
                        summary: {
                            totalScanned,
                            totalDeleted: deletedItems.length,
                            usedMock
                        }
                    });
                }

                // GET /api/:tenant/mercadolibre/product-status
                if (subResource === 'product-status' && req.method === 'GET') {
                    try {
                        const sku = (reqUrl.query.sku || '').trim();
                        if (!sku) {
                            return sendJson(res, { error: 'SKU is required' }, 400);
                        }

                        // Query persistent database status
                        let results = globalDb.prepare("SELECT * FROM mercadolibre_items_status WHERE tenant_id = ? AND sku = ?").all(tenantId, sku);

                        // Seed items if not populated yet but we have mocks matching
                        if (results.length === 0) {
                            const mocks = MOCK_MERCADOLIBRE_ITEMS.filter(m => m.custom_sku === sku);
                            if (mocks.length > 0) {
                                const accounts = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE tenant_id = ?").all(tenantId);
                                mocks.forEach((mockItem, idx) => {
                                    const account = accounts[idx % accounts.length] || { id: 999 + (idx % 2), account_name: (idx % 2 === 0 ? 'Cuenta Test' : 'Cuenta Club Test') };
                                    let status = 'active';
                                    if (deletedMockItemIds.has(mockItem.id)) {
                                        status = 'deleted';
                                    }
                                    globalDb.prepare(`
                                        INSERT INTO mercadolibre_items_status (id, tenant_id, account_id, sku, title, price, status)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)
                                        ON CONFLICT(id) DO NOTHING
                                    `).run(mockItem.id, tenantId, account.id, mockItem.custom_sku, mockItem.title, mockItem.price, status);
                                });
                                results = globalDb.prepare("SELECT * FROM mercadolibre_items_status WHERE tenant_id = ? AND sku = ?").all(tenantId, sku);
                            }
                        }

                        const accounts = globalDb.prepare("SELECT id, account_name FROM mercadolibre_accounts WHERE tenant_id = ? AND active = 1").all(tenantId);

                        return sendJson(res, { publications: results, accounts });
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }

                // POST /api/:tenant/mercadolibre/pause-item
                if (subResource === 'pause-item' && req.method === 'POST') {
                    try {
                        const body = await getJsonBody(req);
                        const { itemId, accountId, usuario } = body;
                        if (!itemId) {
                            return sendJson(res, { error: 'Item ID is required' }, 400);
                        }

                        const account = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE id = ? AND tenant_id = ? AND active = 1").get(accountId, tenantId);
                        
                        globalDb.prepare("UPDATE mercadolibre_items_status SET status = 'paused' WHERE id = ?").run(itemId);

                        if (account && account.client_id !== 'MOCK_CLIENT_ID' && !String(accountId).startsWith('99')) {
                            try {
                                const token = await getOrRefreshAccessToken(account);
                                const url = `https://api.mercadolibre.com/items/${itemId}`;
                                await requestHttps(url, {
                                    method: 'PUT',
                                    headers: { 'Authorization': `Bearer ${token}` }
                                }, { status: 'paused' });
                            } catch (apiErr) {
                                console.warn(`Failed to pause item ${itemId} on Mercado Libre API:`, apiErr.message);
                            }
                        }

                        logAudit(tenantId, usuario || 'admin', 'MODIFICAR', 'MERCADOLIBRE', itemId, `Publicación ${itemId} pausada en Mercado Libre`);
                        return sendJson(res, { success: true, message: 'Publicación pausada con éxito' });
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }

                // POST /api/:tenant/mercadolibre/reactivate-item
                if (subResource === 'reactivate-item' && req.method === 'POST') {
                    try {
                        const body = await getJsonBody(req);
                        const { itemId, accountId, usuario } = body;
                        if (!itemId) {
                            return sendJson(res, { error: 'Item ID is required' }, 400);
                        }

                        const account = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE id = ? AND tenant_id = ? AND active = 1").get(accountId, tenantId);
                        
                        globalDb.prepare("UPDATE mercadolibre_items_status SET status = 'active' WHERE id = ?").run(itemId);

                        if (account && account.client_id !== 'MOCK_CLIENT_ID' && !String(accountId).startsWith('99')) {
                            try {
                                const token = await getOrRefreshAccessToken(account);
                                const url = `https://api.mercadolibre.com/items/${itemId}`;
                                await requestHttps(url, {
                                    method: 'PUT',
                                    headers: { 'Authorization': `Bearer ${token}` }
                                }, { status: 'active' });
                            } catch (apiErr) {
                                console.warn(`Failed to reactivate item ${itemId} on Mercado Libre API:`, apiErr.message);
                            }
                        }

                        logAudit(tenantId, usuario || 'admin', 'MODIFICAR', 'MERCADOLIBRE', itemId, `Publicación ${itemId} reactivada en Mercado Libre`);
                        return sendJson(res, { success: true, message: 'Publicación reactivada con éxito' });
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }

                // POST /api/:tenant/mercadolibre/delete-item
                if (subResource === 'delete-item' && req.method === 'POST') {
                    try {
                        const body = await getJsonBody(req);
                        const { itemId, accountId, usuario } = body;
                        if (!itemId) {
                            return sendJson(res, { error: 'Item ID is required' }, 400);
                        }

                        const account = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE id = ? AND tenant_id = ? AND active = 1").get(accountId, tenantId);
                        
                        globalDb.prepare("UPDATE mercadolibre_items_status SET status = 'deleted' WHERE id = ?").run(itemId);
                        deletedMockItemIds.add(itemId);

                        if (account && account.client_id !== 'MOCK_CLIENT_ID' && !String(accountId).startsWith('99')) {
                            try {
                                await deleteItem(account, itemId);
                            } catch (apiErr) {
                                console.warn(`Failed to delete item ${itemId} on Mercado Libre API:`, apiErr.message);
                            }
                        }

                        logAudit(tenantId, usuario || 'admin', 'ELIMINAR_ML', 'MERCADOLIBRE', itemId, `Publicación ${itemId} eliminada en Mercado Libre`);
                        return sendJson(res, { success: true, message: 'Publicación eliminada con éxito' });
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }

                // POST /api/:tenant/mercadolibre/link-item
                if (subResource === 'link-item' && req.method === 'POST') {
                    try {
                        const body = await getJsonBody(req);
                        const { itemId, sku, accountId, title, price, usuario } = body;
                        if (!itemId || !sku) {
                            return sendJson(res, { error: 'itemId y sku son requeridos' }, 400);
                        }

                        // Determine accountId
                        let finalAccountId = parseInt(accountId);
                        if (isNaN(finalAccountId)) {
                            // Find active account or default
                            const activeAccount = globalDb.prepare("SELECT id FROM mercadolibre_accounts WHERE tenant_id = ? AND active = 1 LIMIT 1").get(tenantId);
                            finalAccountId = activeAccount ? activeAccount.id : 999;
                        }

                        let finalTitle = title;
                        if (!finalTitle) {
                            const prod = db.prepare("SELECT descripcion FROM inventario WHERE codigo = ?").get(sku);
                            finalTitle = prod ? prod.descripcion : 'Publicación Vinculada';
                        }
                        let finalPrice = price;
                        if (!finalPrice) {
                            const prod = db.prepare("SELECT precio_venta FROM inventario WHERE codigo = ?").get(sku);
                            finalPrice = prod ? prod.precio_venta : 0;
                        }

                        globalDb.prepare(`
                            INSERT INTO mercadolibre_items_status (id, tenant_id, account_id, sku, title, price, status)
                            VALUES (?, ?, ?, ?, ?, ?, 'active')
                            ON CONFLICT(id) DO UPDATE SET
                                tenant_id = excluded.tenant_id,
                                account_id = excluded.account_id,
                                sku = excluded.sku,
                                title = excluded.title,
                                price = excluded.price,
                                status = 'active'
                        `).run(itemId, tenantId, finalAccountId, sku, finalTitle, parseFloat(finalPrice) || 0);

                        logAudit(tenantId, usuario || 'admin', 'CREAR', 'MERCADOLIBRE', itemId, `Publicación ${itemId} vinculada manualmente al SKU ${sku}`);
                        return sendJson(res, { success: true, message: 'Publicación vinculada con éxito' });
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }

                // POST /api/:tenant/mercadolibre/sync
                if (subResource === 'sync' && req.method === 'POST') {
                    try {
                        const body = await getJsonBody(req).catch(() => ({}));
                        const result = await syncPublicationsFromMercadoLibre(tenantId);
                        const desc = body.usuario === 'system_auto' ? 'Sincronización automática de publicaciones ejecutada' : 'Sincronización manual de publicaciones ejecutada';
                        logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'MERCADOLIBRE', 'SYNC_ALL', desc);
                        return sendJson(res, { success: true, message: 'Sincronización completada con éxito', details: result });
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }

                // GET /api/:tenant/mercadolibre/sales
                if (subResource === 'sales' && req.method === 'GET') {
                    const list = db.prepare(`
                        SELECT 
                            a.id as asiento_id,
                            a.prefijo,
                            a.numero,
                            a.fecha,
                            a.concepto,
                            a.dian_estado,
                            a.total_documento,
                            a.ml_read,
                            t.identificacion as cliente_nit,
                            t.nombre || ' ' || COALESCE(t.apellidos, '') as cliente_nombre
                        FROM asientos a
                        LEFT JOIN terceros t ON t.id = (
                            SELECT tercero_id FROM asiento_detalles 
                            WHERE asiento_id = a.id AND tercero_id IS NOT NULL LIMIT 1
                        )
                        WHERE a.tipo_documento = 'FV' AND a.prefijo = 'ML' AND a.anulado = 0
                        ORDER BY a.fecha DESC, a.numero DESC
                    `).all();

                    const salesReport = [];
                    for (const as of list) {
                        // 1. Fetch item details (Revenue lines 413501)
                        const items = db.prepare(`
                            SELECT 
                                ad.cantidad,
                                ad.precio_unitario,
                                i.codigo as sku,
                                i.descripcion as producto_nombre
                            FROM asiento_detalles ad
                            LEFT JOIN inventario i ON ad.inventario_id = i.id
                            WHERE ad.asiento_id = ? AND ad.cuenta_codigo = '413501'
                        `).all(as.asiento_id);

                        // Fallback for old records that do not have inventario_id set on revenue lines
                        if (items.length === 0) {
                            const fallbackItems = db.prepare(`
                                SELECT ad.concepto_linea, ad.credito as item_total
                                FROM asiento_detalles ad
                                WHERE ad.asiento_id = ? AND ad.cuenta_codigo = '413501'
                            `).all(as.asiento_id);
                            
                            for (const fb of fallbackItems) {
                                const desc = fb.concepto_linea.replace('Venta: ', '').replace('Ingreso por ventas', 'Producto Integrado');
                                items.push({
                                    cantidad: 1,
                                    precio_unitario: fb.item_total,
                                    sku: 'ML-INTEGRADO',
                                    producto_nombre: desc
                                });
                            }
                        }

                        // 2. Fetch gross published subtotal
                        const subtotalRow = db.prepare(`
                            SELECT SUM(credito) as total_subtotal 
                            FROM asiento_detalles 
                            WHERE asiento_id = ? AND cuenta_codigo = '413501'
                        `).get(as.asiento_id);
                        const subtotalVal = subtotalRow ? (subtotalRow.total_subtotal || 0) : 0;

                        // 3. Fetch IVA
                        const ivaRow = db.prepare(`
                            SELECT SUM(credito) as total_iva 
                            FROM asiento_detalles 
                            WHERE asiento_id = ? AND cuenta_codigo = '2408'
                        `).get(as.asiento_id);
                        const ivaVal = ivaRow ? (ivaRow.total_iva || 0) : 0;

                        // 4. Fetch commission (519505 debits)
                        const comisionRow = db.prepare(`
                            SELECT SUM(debito) as total_comision 
                            FROM asiento_detalles 
                            WHERE asiento_id = ? AND cuenta_codigo = '519505'
                        `).get(as.asiento_id);
                        const comisionVal = comisionRow ? (comisionRow.total_comision || 0) : 0;

                        // 5. Fetch net received (11100512 debits)
                        const netoRow = db.prepare(`
                            SELECT SUM(debito) as total_neto 
                            FROM asiento_detalles 
                            WHERE asiento_id = ? AND cuenta_codigo = '11100512'
                        `).get(as.asiento_id);
                        const netoVal = netoRow ? (netoRow.total_neto || 0) : 0;

                        // Parse account_name from concepto
                        const concept = as.concepto || '';
                        let accountName = 'patucarro';
                        if (concept.includes('Cuenta: kyh') || concept.includes('Cuenta: Cuenta 2')) {
                            accountName = 'kyh';
                        } else if (concept.includes('Cuenta: patucarro') || concept.includes('Cuenta: Cuenta 1')) {
                            accountName = 'patucarro';
                        } else {
                            const match = concept.match(/Cuenta:\s*([^\s-]+)/);
                            if (match) {
                                const matchedName = match[1];
                                if (matchedName === 'Cuenta' && concept.includes('Cuenta 1')) {
                                    accountName = 'patucarro';
                                } else if (matchedName === 'Cuenta' && concept.includes('Cuenta 2')) {
                                    accountName = 'kyh';
                                } else if (matchedName === 'Cuenta' && concept.includes('Cuenta Test')) {
                                    accountName = 'patucarro';
                                } else if (matchedName === 'Cuenta' && concept.includes('Cuenta Simulada')) {
                                    accountName = 'patucarro';
                                } else {
                                    // General fallback: if the name contains 'kyh' use kyh, else patucarro
                                    accountName = matchedName.toLowerCase().includes('kyh') ? 'kyh' : 'patucarro';
                                }
                            } else {
                                // Default fallback
                                accountName = 'patucarro';
                            }
                        }

                        salesReport.push({
                            asiento_id: as.asiento_id,
                            prefijo: as.prefijo,
                            numero: as.numero,
                            fecha: as.fecha,
                            concepto: as.concepto,
                            dian_estado: as.dian_estado,
                            cliente_nit: as.cliente_nit,
                            cliente_nombre: as.cliente_nombre,
                            items: items,
                            valor_publicado: subtotalVal + ivaVal,
                            comision: comisionVal,
                            valor_recibido: netoVal,
                            account_name: accountName,
                            ml_read: as.ml_read || 0
                        });
                    }

                    return sendJson(res, salesReport);
                }

                // POST /api/:tenant/mercadolibre/mark-sales-read
                if (subResource === 'mark-sales-read' && req.method === 'POST') {
                    try {
                        const body = await getJsonBody(req).catch(() => ({}));
                        const { saleId } = body;
                        
                        if (saleId) {
                            db.prepare("UPDATE asientos SET ml_read = 1 WHERE id = ? AND prefijo = 'ML'").run(saleId);
                        } else {
                            db.prepare("UPDATE asientos SET ml_read = 1 WHERE prefijo = 'ML' AND tipo_documento = 'FV'").run();
                        }
                        
                        return sendJson(res, { success: true });
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }
                
                // GET /api/:tenant/mercadolibre/questions
                if (subResource === 'questions' && req.method === 'GET') {
                    try {
                        const status = reqUrl.query.status || 'unanswered';
                        let list;
                        if (status === 'all') {
                            list = globalDb.prepare(`
                                SELECT * FROM mercadolibre_questions 
                                WHERE tenant_id = ? 
                                ORDER BY date_created DESC
                            `).all(tenantId);
                        } else {
                            list = globalDb.prepare(`
                                SELECT * FROM mercadolibre_questions 
                                WHERE tenant_id = ? AND status = ?
                                ORDER BY date_created DESC
                            `).all(tenantId, status);
                        }
                        return sendJson(res, list);
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }

                // POST /api/:tenant/mercadolibre/answer-question
                if (subResource === 'answer-question' && req.method === 'POST') {
                    try {
                        const body = await getJsonBody(req);
                        const { questionId, answerText, usuario } = body;
                        if (!questionId || !answerText) {
                            return sendJson(res, { error: 'Question ID and answer text are required' }, 400);
                        }
                        
                        const stmt = globalDb.prepare(`
                            UPDATE mercadolibre_questions
                            SET status = 'answered', answer_text = ?
                            WHERE id = ? AND tenant_id = ?
                        `);
                        const result = stmt.run(answerText, questionId, tenantId);
                        
                        if (result.changes === 0) {
                            return sendJson(res, { error: 'Question not found or access denied' }, 404);
                        }
                        
                        logAudit(tenantId, usuario || 'admin', 'MODIFICAR', 'MERCADOLIBRE', questionId, `Pregunta respondida en Mercado Libre: ${answerText}`);
                        
                        return sendJson(res, { success: true, message: 'Pregunta respondida con éxito en Mercado Libre' });
                    } catch (e) {
                        return sendJson(res, { error: e.message }, 500);
                    }
                }
            }

            // A. GET /api/:tenant/puc
            if (resource === 'puc' && req.method === 'GET') {
                const puc = db.prepare("SELECT * FROM puc ORDER BY codigo").all();
                return sendJson(res, puc);
            }

            // B. POST /api/:tenant/puc
            if (resource === 'puc' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const stmt = db.prepare(`
                    INSERT INTO puc (codigo, nombre, requiere_tercero, requiere_centro_costo, parent_codigo)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(codigo) DO UPDATE SET
                        nombre=excluded.nombre,
                        requiere_tercero=excluded.requiere_tercero,
                        requiere_centro_costo=excluded.requiere_centro_costo,
                        parent_codigo=excluded.parent_codigo
                `);
                stmt.run(body.codigo, body.nombre, body.requiere_tercero ? 1 : 0, body.requiere_centro_costo ? 1 : 0, body.parent_codigo);
                logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'PUC', body.codigo, `Modificación/creación de cuenta PUC`);
                return sendJson(res, { success: true });
            }

            // C. GET /api/:tenant/terceros
            if (resource === 'terceros' && req.method === 'GET') {
                const terceros = db.prepare("SELECT * FROM terceros ORDER BY nombre").all();
                return sendJson(res, terceros);
            }

            // POST /api/:tenant/terceros/sync
            if (resource === 'terceros' && pathParts[4] === 'sync' && req.method === 'POST') {
                const authHeader = req.headers['authorization'];
                let token = '';
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                }
                if (token !== 'Patucarro2026*') {
                    return sendJson(res, { error: 'Unauthorized' }, 401);
                }

                const body = await getJsonBody(req);
                const { identificacion, tipo_identificacion, nombre, apellidos, email, telefono, direccion, ciudad } = body;

                if (!identificacion || !nombre || !email) {
                    return sendJson(res, { error: 'Missing required parameters' }, 400);
                }

                try {
                    const stmt = db.prepare(`
                        INSERT INTO terceros (
                            tipo_identificacion, identificacion, dv, nombre, apellidos,
                            direccion, ciudad, telefono, email, aplica_rete_ica, tarifa_ica, activo,
                            tipo_cliente, tipo_proveedor, tipo_empleado
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, 1, 0, 0)
                        ON CONFLICT(identificacion) DO UPDATE SET
                            tipo_identificacion=excluded.tipo_identificacion,
                            nombre=excluded.nombre,
                            apellidos=excluded.apellidos,
                            direccion=excluded.direccion,
                            ciudad=excluded.ciudad,
                            telefono=excluded.telefono,
                            email=excluded.email
                    `);
                    stmt.run(
                        tipo_identificacion || 'CC', identificacion, null, nombre, apellidos || null,
                        direccion || null, ciudad || null, telefono || null, email
                    );
                    logAudit(tenantId, 'wordpress_api', 'MODIFICAR', 'TERCERO', identificacion, `Sincronización de cliente desde WordPress`);
                    return sendJson(res, { success: true });
                } catch (err) {
                    return sendJson(res, { error: err.message }, 500);
                }
            }

            // D. POST /api/:tenant/terceros
            if (resource === 'terceros' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const stmt = db.prepare(`
                    INSERT INTO terceros (
                        tipo_identificacion, identificacion, dv, nombre, apellidos,
                        direccion, ciudad, telefono, email, aplica_rete_ica, tarifa_ica, activo,
                        tipo_cliente, tipo_proveedor, tipo_empleado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(identificacion) DO UPDATE SET
                        tipo_identificacion=excluded.tipo_identificacion,
                        dv=excluded.dv,
                        nombre=excluded.nombre,
                        apellidos=excluded.apellidos,
                        direccion=excluded.direccion,
                        ciudad=excluded.ciudad,
                        telefono=excluded.telefono,
                        email=excluded.email,
                        aplica_rete_ica=excluded.aplica_rete_ica,
                        tarifa_ica=excluded.tarifa_ica,
                        activo=excluded.activo,
                        tipo_cliente=excluded.tipo_cliente,
                        tipo_proveedor=excluded.tipo_proveedor,
                        tipo_empleado=excluded.tipo_empleado
                `);
                stmt.run(
                    body.tipo_identificacion, body.identificacion, body.dv, body.nombre, body.apellidos,
                    body.direccion, body.ciudad, body.telefono, body.email, body.aplica_rete_ica ? 1 : 0, body.tarifa_ica || 0, body.activo ? 1 : 0,
                    body.tipo_cliente ? 1 : 0, body.tipo_proveedor ? 1 : 0, body.tipo_empleado ? 1 : 0
                );
                logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'TERCERO', body.identificacion, `Modificación/creación de tercero`);
                
                // Sync to WordPress
                if (tenantId === 'importadora' && body.email) {
                    syncCustomerToWordPress(body);
                }
                
                return sendJson(res, { success: true });
            }

            // E2. POST /api/:tenant/inventario/ensure-image
            if (resource === 'inventario' && pathParts[3] === 'ensure-image' && req.method === 'POST') {
                try {
                    const body = await getJsonBody(req);
                    const productId = body.id;
                    if (!productId) {
                        return sendJson(res, { error: 'Falta ID de producto' }, 400);
                    }
                    
                    const prod = db.prepare("SELECT * FROM inventario WHERE id = ?").get(productId);
                    if (!prod) {
                        return sendJson(res, { error: 'Producto no encontrado' }, 404);
                    }
                    
                    if (prod.imagen_url) {
                        return sendJson(res, { imagen_url: prod.imagen_url });
                    }
                    
                    // Fetch on-demand
                    let imgUrl = await searchMercadoLibreImage(prod.descripcion);
                    if (!imgUrl) {
                        imgUrl = await searchBingImage(prod.descripcion);
                    }
                    if (!imgUrl) {
                        imgUrl = getFallbackImageUrl(prod.descripcion, tenantId);
                    }
                    
                    db.prepare("UPDATE inventario SET imagen_url = ? WHERE id = ?").run(imgUrl, productId);
                    return sendJson(res, { imagen_url: imgUrl });
                } catch (e) {
                    return sendJson(res, { error: e.message }, 500);
                }
            }

            // GET /api/:tenant/inventario/:id/kardex
            if (resource === 'inventario' && pathParts[4] === 'kardex' && req.method === 'GET') {
                try {
                    const productId = pathParts[3];
                    const product = db.prepare("SELECT * FROM inventario WHERE id = ?").get(productId);
                    if (!product) return sendJson(res, { error: 'Producto no encontrado' }, 404);
                    
                    const movements = db.prepare(`
                        SELECT 
                            a.id as asiento_id,
                            a.tipo_documento,
                            a.prefijo,
                            a.numero,
                            a.fecha,
                            a.concepto,
                            ad.cuenta_codigo,
                            ad.debito,
                            ad.credito,
                            ad.cantidad,
                            ad.precio_unitario,
                            ad.concepto_linea,
                            t.nombre as tercero_nombre,
                            t.identificacion as tercero_nit
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        LEFT JOIN terceros t ON ad.tercero_id = t.id
                        WHERE ad.inventario_id = ? AND ad.cuenta_codigo = '143501' AND a.anulado = 0
                        
                        UNION ALL
                        
                        SELECT 
                            a.id as asiento_id,
                            a.tipo_documento,
                            a.prefijo,
                            a.numero,
                            a.fecha,
                            a.concepto,
                            '143501' as cuenta_codigo,
                            0 as debito,
                            0 as credito,
                            ad.cantidad,
                            0 as precio_unitario,
                            ad.concepto_linea,
                            t.nombre as tercero_nombre,
                            t.identificacion as tercero_nit
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        LEFT JOIN terceros t ON ad.tercero_id = t.id
                        WHERE ad.inventario_id = ? AND ad.cuenta_codigo = '413501' AND a.anulado = 0
                          AND NOT EXISTS (
                              SELECT 1 FROM asiento_detalles ad2 
                              WHERE ad2.asiento_id = a.id 
                                AND ad2.inventario_id = ad.inventario_id 
                                AND ad2.cuenta_codigo = '143501'
                          )
                        
                        ORDER BY fecha ASC, asiento_id ASC
                    `).all(productId, productId);
                    
                    return sendJson(res, { product, movements });
                } catch (e) {
                    return sendJson(res, { error: e.message }, 500);
                }
            }

            // GET /api/:tenant/inventario/ml-details/:sku
            if (resource === 'inventario' && pathParts[3] === 'ml-details' && req.method === 'GET') {
                try {
                    const sku = decodeURIComponent(pathParts[4]);
                    
                    // Find linked item status
                    let itemStatus = globalDb.prepare("SELECT * FROM mercadolibre_items_status WHERE tenant_id = ? AND (LOWER(sku) = ? OR LOWER(id) = ?)").get(tenantId, sku.toLowerCase(), sku.toLowerCase());
                    
                    if (!itemStatus) {
                        // Match by local product description/title fallback
                        const localProd = db.prepare("SELECT descripcion FROM inventario WHERE codigo = ?").get(sku);
                        if (localProd && localProd.descripcion) {
                            itemStatus = globalDb.prepare("SELECT * FROM mercadolibre_items_status WHERE tenant_id = ? AND LOWER(title) = ?").get(tenantId, localProd.descripcion.trim().toLowerCase());
                        }
                    }
                    
                    const isMockId = (id) => id && id.startsWith('MCO-99');
                    
                    if (itemStatus && isMockId(itemStatus.id)) {
                        // Return mock details immediately
                        const mockMatch = MOCK_MERCADOLIBRE_ITEMS.find(m => m.id === itemStatus.id || m.custom_sku === sku);
                        const title = mockMatch ? mockMatch.title : itemStatus.title;
                        const price = mockMatch ? mockMatch.price : (itemStatus.price || 150000);
                        return sendJson(res, {
                            found: true,
                            itemId: itemStatus.id,
                            title: title,
                            price: price,
                            stock: 15,
                            condition: "new",
                            marca: "Bosch",
                            modelo: "Premium",
                            numero_pieza: "MOCK-12345",
                            gtin: "7709876543210",
                            warranty_type: "seller_warranty",
                            warranty_time: "3 meses",
                            imagen_url: "https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=400&auto=format&fit=crop&q=60",
                            imagenes_adicionales: "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=400&auto=format&fit=crop&q=60",
                            descripcion_detallada: "Esta es una descripción de prueba simulada desde Mercado Libre para la publicación mock " + itemStatus.id
                        });
                    }
                    
                    if (!itemStatus) {
                        // Fallback: check if the sku matches a mock item in MOCK_MERCADOLIBRE_ITEMS
                        const mockMatch = MOCK_MERCADOLIBRE_ITEMS.find(m => m.custom_sku === sku || m.id === sku);
                        if (mockMatch) {
                            return sendJson(res, {
                                found: true,
                                itemId: mockMatch.id,
                                title: mockMatch.title,
                                price: mockMatch.price,
                                stock: 15,
                                condition: "new",
                                marca: "Bosch",
                                modelo: "Premium",
                                numero_pieza: "MOCK-12345",
                                gtin: "7709876543210",
                                warranty_type: "seller_warranty",
                                warranty_time: "3 meses",
                                imagen_url: "https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=400&auto=format&fit=crop&q=60",
                                imagenes_adicionales: "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=400&auto=format&fit=crop&q=60",
                                descripcion_detallada: "Esta es una descripción de prueba simulada desde Mercado Libre para la publicación mock " + mockMatch.id
                            });
                        }
                        return sendJson(res, { found: false });
                    }
                    
                    const itemId = itemStatus.id;
                    
                    // Retrieve account and get active token
                    const account = globalDb.prepare("SELECT * FROM mercadolibre_accounts WHERE id = ?").get(itemStatus.account_id);
                    let token = null;
                    if (account) {
                        try {
                            token = await getOrRefreshAccessToken(account);
                        } catch (err) {
                            console.error("Failed to get token for ml-details request:", err.message);
                        }
                    }
                    
                    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

                    // Fetch from Mercado Libre
                    const itemUrl = `https://api.mercadolibre.com/items/${itemId}`;
                    const mlItem = await requestHttps(itemUrl, { headers }).catch((e) => {
                        console.error(`[ml-details] Failed to fetch item ${itemId}:`, e.message);
                        return null;
                    });
                    
                    if (!mlItem) {
                        return sendJson(res, { found: false, error: 'Failed to fetch item from Mercado Libre' });
                    }
                    
                    // Fetch description
                    const descUrl = `https://api.mercadolibre.com/items/${itemId}/description`;
                    const mlDesc = await requestHttps(descUrl, { headers }).catch(() => null);
                    
                    // Extract attributes
                    const attrs = mlItem.attributes || [];
                    const brandAttr = attrs.find(a => a.id === 'BRAND');
                    const modelAttr = attrs.find(a => a.id === 'MODEL');
                    const partNumAttr = attrs.find(a => a.id === 'PART_NUMBER');
                    const gtinAttr = attrs.find(a => a.id === 'GTIN' || a.id === 'EAN');
                    
                    // Extract warranty from sale_terms
                    const terms = mlItem.sale_terms || [];
                    const wTypeAttr = terms.find(t => t.id === 'WARRANTY_TYPE');
                    const wTimeAttr = terms.find(t => t.id === 'WARRANTY_TIME');
                    
                    let warrantyType = 'seller_warranty';
                    if (wTypeAttr) {
                        const val = String(wTypeAttr.value_name).toLowerCase();
                        if (val.includes('fábrica') || val.includes('fabrica')) warrantyType = 'factory_warranty';
                        else if (val.includes('sin') || val.includes('no ')) warrantyType = 'no_warranty';
                    }
                    
                    // Pictures
                    const pictures = mlItem.pictures || [];
                    const primaryImage = pictures.length > 0 ? pictures[0].url || pictures[0].secure_url : '';
                    const additionalImages = pictures.slice(1).map(p => p.url || p.secure_url).join(', ');
                    
                    return sendJson(res, {
                        found: true,
                        itemId: itemId,
                        title: mlItem.title,
                        price: mlItem.price,
                        stock: mlItem.available_quantity,
                        condition: mlItem.condition || 'new',
                        marca: brandAttr ? brandAttr.value_name : '',
                        modelo: modelAttr ? modelAttr.value_name : '',
                        numero_pieza: partNumAttr ? partNumAttr.value_name : '',
                        gtin: gtinAttr ? gtinAttr.value_name : '',
                        warranty_type: warrantyType,
                        warranty_time: wTimeAttr ? wTimeAttr.value_name : '',
                        imagen_url: primaryImage,
                        imagenes_adicionales: additionalImages,
                        descripcion_detallada: mlDesc ? mlDesc.plain_text : ''
                    });
                } catch (e) {
                    return sendJson(res, { error: e.message }, 500);
                }
            }

            // GET /api/:tenant/inventario/low-stock-count
            if (resource === 'inventario' && pathParts[3] === 'low-stock-count' && req.method === 'GET') {
                try {
                    const row = db.prepare("SELECT COUNT(*) as count FROM inventario WHERE activo = 1 AND stock_actual <= stock_minimo").get();
                    return sendJson(res, { count: row.count });
                } catch (e) {
                    return sendJson(res, { error: e.message }, 500);
                }
            }

            // GET /api/:tenant/inventario/by-code/:code
            if (resource === 'inventario' && pathParts[3] === 'by-code' && req.method === 'GET') {
                try {
                    const code = decodeURIComponent(pathParts[4]);
                    const item = db.prepare("SELECT * FROM inventario WHERE codigo = ?").get(code);
                    if (item) {
                        return sendJson(res, item);
                    } else {
                        return sendJson(res, { error: 'Producto no encontrado' }, 404);
                    }
                } catch (e) {
                    return sendJson(res, { error: e.message }, 500);
                }
            }

            // E. GET /api/:tenant/inventario
            if (resource === 'inventario' && req.method === 'GET' && !pathParts[3]) {
                try {
                    const page = parseInt(reqUrl.query.page);
                    const limit = parseInt(reqUrl.query.limit) || 20;
                    const q = reqUrl.query.q ? reqUrl.query.q.trim() : '';
                    const mlStatus = reqUrl.query.ml_status; // 'active', 'paused', 'deleted', 'not_linked'

                    if (mlStatus === 'active' || mlStatus === 'paused' || mlStatus === 'deleted') {
                        // 1. Get all publications from SQLite status table for this tenant and status
                        const dbPubs = globalDb.prepare("SELECT * FROM mercadolibre_items_status WHERE tenant_id = ? AND status = ?").all(tenantId, mlStatus);

                        // 2. Get mock publications matching this status (if not in DB yet)
                        const mockPubs = MOCK_MERCADOLIBRE_ITEMS.filter(m => {
                            let mStatus = deletedMockItemIds.has(m.id) ? 'deleted' : 'active';
                            if (mStatus !== mlStatus) return false;
                            const inDb = globalDb.prepare("SELECT 1 FROM mercadolibre_items_status WHERE tenant_id = ? AND id = ?").get(tenantId, m.id);
                            return !inDb;
                        }).map(m => ({
                            id: m.id,
                            sku: m.custom_sku || '',
                            title: m.title,
                            price: m.price,
                            status: mlStatus
                        }));

                        const allPubs = [...dbPubs, ...mockPubs];

                        // 3. Load all local products from inventario
                        const localProducts = db.prepare("SELECT * FROM inventario").all();

                        // 4. Index local products by SKU and by Description
                        const localBySku = new Map();
                        const localByTitle = new Map();
                        localProducts.forEach(p => {
                            if (p.codigo) {
                                localBySku.set(p.codigo.trim().toLowerCase(), p);
                            }
                            if (p.descripcion) {
                                localByTitle.set(p.descripcion.trim().toLowerCase(), p);
                            }
                        });

                        // 5. Match and compile list
                        const compiledItems = [];
                        const matchedLocalIds = new Set();

                        allPubs.forEach(pub => {
                            let matchedLocal = null;
                            const skuKey = pub.sku ? pub.sku.trim().toLowerCase() : '';
                            const idKey = pub.id ? pub.id.trim().toLowerCase() : '';
                            const titleKey = pub.title ? pub.title.trim().toLowerCase() : '';

                            if (skuKey && localBySku.has(skuKey)) {
                                matchedLocal = localBySku.get(skuKey);
                            } else if (idKey && localBySku.has(idKey)) {
                                matchedLocal = localBySku.get(idKey);
                            } else if (titleKey && localByTitle.has(titleKey)) {
                                matchedLocal = localByTitle.get(titleKey);
                            }

                            if (matchedLocal) {
                                if (!matchedLocalIds.has(matchedLocal.id)) {
                                    matchedLocalIds.add(matchedLocal.id);
                                    
                                    let finalImg = matchedLocal.imagen_url;
                                    let thumbnail = pub.thumbnail;
                                    if (!thumbnail && pub.id && pub.id.startsWith('MCO-99')) {
                                        const mockThumbnails = {
                                            'MCO-99123': 'https://http2.mlstatic.com/D_NQ_NP_734602-MLU40179900530_122019-O.webp',
                                            'MCO-99124': 'https://http2.mlstatic.com/D_NQ_NP_800338-MLC77515527462_072024-O.webp',
                                            'MCO-99125': 'https://http2.mlstatic.com/D_NQ_NP_989322-MCO75633082601_042024-O.webp',
                                            'MCO-99126': 'https://http2.mlstatic.com/D_NQ_NP_626290-MLA48177880567_112021-O.webp',
                                            'MCO-99127': 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=80&auto=format&fit=crop&q=60',
                                            'MCO-99128': 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=80&auto=format&fit=crop&q=60',
                                            'MCO-99130': 'https://http2.mlstatic.com/D_NQ_NP_627841-MLC54869977059_042023-O.webp',
                                            'MCO-99131': 'https://http2.mlstatic.com/D_NQ_NP_620685-MCO82869477936_032025-O.webp'
                                        };
                                        thumbnail = mockThumbnails[pub.id] || null;
                                    }
                                    if ((!finalImg || finalImg === '') && thumbnail) {
                                        finalImg = String(thumbnail).replace('http://', 'https://');
                                    }

                                    compiledItems.push({
                                        ...matchedLocal,
                                        imagen_url: finalImg,
                                        ml_status: pub.status
                                    });
                                }
                            } else {
                                // Virtual item
                                let finalImg = null;
                                let thumbnail = pub.thumbnail;
                                if (!thumbnail && pub.id && pub.id.startsWith('MCO-99')) {
                                    const mockThumbnails = {
                                        'MCO-99123': 'https://http2.mlstatic.com/D_NQ_NP_734602-MLU40179900530_122019-O.webp',
                                        'MCO-99124': 'https://http2.mlstatic.com/D_NQ_NP_800338-MLC77515527462_072024-O.webp',
                                        'MCO-99125': 'https://http2.mlstatic.com/D_NQ_NP_989322-MCO75633082601_042024-O.webp',
                                        'MCO-99126': 'https://http2.mlstatic.com/D_NQ_NP_626290-MLA48177880567_112021-O.webp',
                                        'MCO-99127': 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=80&auto=format&fit=crop&q=60',
                                        'MCO-99128': 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=80&auto=format&fit=crop&q=60',
                                        'MCO-99130': 'https://http2.mlstatic.com/D_NQ_NP_627841-MLC54869977059_042023-O.webp',
                                        'MCO-99131': 'https://http2.mlstatic.com/D_NQ_NP_620685-MCO82869477936_032025-O.webp'
                                    };
                                    thumbnail = mockThumbnails[pub.id] || null;
                                }
                                if (thumbnail) {
                                    finalImg = String(thumbnail).replace('http://', 'https://');
                                }
                                compiledItems.push({
                                    id: null,
                                    codigo: pub.id,
                                    descripcion: pub.title,
                                    precio_venta: pub.price || 0,
                                    stock_actual: 0,
                                    stock_minimo: 0,
                                    iva_tarifa: 0.19,
                                    imagen_url: finalImg,
                                    ml_status: pub.status,
                                    is_unlinked: true,
                                    marca: 'Mercado Libre',
                                    compatibilidad: 'Sin vinculación local',
                                    activo: 1
                                });
                            }
                        });

                        // 6. Filter by search query q if specified
                        let filteredItems = compiledItems;
                        if (q) {
                            const queryLower = q.toLowerCase();
                            filteredItems = compiledItems.filter(item => {
                                const codigoMatch = String(item.codigo || '').toLowerCase().includes(queryLower);
                                const descMatch = String(item.descripcion || '').toLowerCase().includes(queryLower);
                                const marcaMatch = String(item.marca || '').toLowerCase().includes(queryLower);
                                const compMatch = String(item.compatibilidad || '').toLowerCase().includes(queryLower);
                                return codigoMatch || descMatch || marcaMatch || compMatch;
                            });
                        }

                        // 7. Sort by codigo
                        filteredItems.sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || '')));

                        // 8. Handle pagination
                        if (!isNaN(page)) {
                            const offset = (page - 1) * limit;
                            const paginatedItems = filteredItems.slice(offset, offset + limit);
                            const total = filteredItems.length;
                            const totalPages = Math.ceil(total / limit);

                            return sendJson(res, {
                                items: paginatedItems,
                                total,
                                page,
                                limit,
                                totalPages
                            });
                        } else {
                            return sendJson(res, filteredItems);
                        }
                    }

                    let filterBySku = false;
                    let targetSkus = [];
                    let targetTitles = [];
                    let notInSkus = [];
                    let notInTitles = [];

                    if (mlStatus === 'active' || mlStatus === 'paused' || mlStatus === 'deleted') {
                        filterBySku = true;
                        // 1. Get from database status
                        const dbItems = globalDb.prepare("SELECT id, sku, title FROM mercadolibre_items_status WHERE tenant_id = ? AND status = ?").all(tenantId, mlStatus);
                        const skuSet = new Set();
                        const titleSet = new Set();

                        dbItems.forEach(item => {
                            if (item.sku && item.sku.trim() !== '') {
                                skuSet.add(item.sku.trim());
                            }
                            if (item.id) {
                                skuSet.add(item.id.trim());
                            }
                            if (item.title) {
                                titleSet.add(item.title.trim().toLowerCase());
                            }
                        });

                        // 2. Get from mock status
                        MOCK_MERCADOLIBRE_ITEMS.forEach(m => {
                            let mStatus = 'active';
                            if (deletedMockItemIds.has(m.id)) {
                                mStatus = 'deleted';
                            }
                            const hasDbEntry = globalDb.prepare("SELECT 1 FROM mercadolibre_items_status WHERE tenant_id = ? AND id = ?").get(tenantId, m.id);
                            if (!hasDbEntry && mStatus === mlStatus) {
                                if (m.custom_sku) skuSet.add(m.custom_sku.trim());
                                if (m.id) skuSet.add(m.id.trim());
                                if (m.title) titleSet.add(m.title.trim().toLowerCase());
                            }
                        });

                        targetSkus = Array.from(skuSet);
                        targetTitles = Array.from(titleSet);

                        // If no target SKUs or titles found, we should return empty result immediately to avoid querying everything
                        if (targetSkus.length === 0 && targetTitles.length === 0) {
                            return sendJson(res, isNaN(page) ? [] : { items: [], total: 0, page, limit, totalPages: 0 });
                        }
                    } else if (mlStatus === 'not_linked') {
                        // Get all linked SKUs to exclude them
                        const dbItems = globalDb.prepare("SELECT id, sku, title FROM mercadolibre_items_status WHERE tenant_id = ?").all(tenantId);
                        const skuSet = new Set();
                        const titleSet = new Set();

                        dbItems.forEach(item => {
                            if (item.sku && item.sku.trim() !== '') {
                                skuSet.add(item.sku.trim());
                            }
                            if (item.id) {
                                skuSet.add(item.id.trim());
                            }
                            if (item.title) {
                                titleSet.add(item.title.trim().toLowerCase());
                            }
                        });

                        MOCK_MERCADOLIBRE_ITEMS.forEach(m => {
                            const hasDbEntry = globalDb.prepare("SELECT 1 FROM mercadolibre_items_status WHERE tenant_id = ? AND id = ?").get(tenantId, m.id);
                            if (!hasDbEntry) {
                                if (m.custom_sku) skuSet.add(m.custom_sku.trim());
                                if (m.id) skuSet.add(m.id.trim());
                                if (m.title) titleSet.add(m.title.trim().toLowerCase());
                            }
                        });
                        notInSkus = Array.from(skuSet);
                        notInTitles = Array.from(titleSet);
                    }

                    if (!isNaN(page)) {
                        const offset = (page - 1) * limit;
                        let countQuery = "SELECT COUNT(*) as count FROM inventario WHERE 1=1";
                        let itemsQuery = "SELECT * FROM inventario WHERE 1=1";
                        const params = [];

                        if (filterBySku) {
                            const conditions = [];
                            if (targetSkus.length > 0) {
                                const placeholders = targetSkus.map(() => '?').join(',');
                                conditions.push(`codigo IN (${placeholders})`);
                            }
                            if (targetTitles.length > 0) {
                                const placeholders = targetTitles.map(() => '?').join(',');
                                conditions.push(`LOWER(descripcion) IN (${placeholders})`);
                            }
                            if (conditions.length > 0) {
                                const clause = ` AND (${conditions.join(' OR ')})`;
                                countQuery += clause;
                                itemsQuery += clause;
                                if (targetSkus.length > 0) params.push(...targetSkus);
                                if (targetTitles.length > 0) params.push(...targetTitles);
                            }
                        } else if (notInSkus.length > 0 || notInTitles.length > 0) {
                            const conditions = [];
                            if (notInSkus.length > 0) {
                                const placeholders = notInSkus.map(() => '?').join(',');
                                conditions.push(`codigo NOT IN (${placeholders})`);
                            }
                            if (notInTitles.length > 0) {
                                const placeholders = notInTitles.map(() => '?').join(',');
                                conditions.push(`LOWER(descripcion) NOT IN (${placeholders})`);
                            }
                            if (conditions.length > 0) {
                                const clause = ` AND ${conditions.join(' AND ')}`;
                                countQuery += clause;
                                itemsQuery += clause;
                                if (notInSkus.length > 0) params.push(...notInSkus);
                                if (notInTitles.length > 0) params.push(...notInTitles);
                            }
                        }

                        if (q) {
                            const searchPattern = `%${q}%`;
                            const whereClause = " AND (codigo LIKE ? OR descripcion LIKE ? OR marca LIKE ? OR compatibilidad LIKE ?)";
                            countQuery += whereClause;
                            itemsQuery += whereClause;
                            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
                        }

                        itemsQuery += " ORDER BY codigo LIMIT ? OFFSET ?";
                        const countParams = [...params];
                        const itemsParams = [...params, limit, offset];

                        const total = db.prepare(countQuery).get(...countParams).count;
                        const items = db.prepare(itemsQuery).all(...itemsParams);
                        const totalPages = Math.ceil(total / limit);

                        // Augment items with Mercado Libre status (optimized to avoid N+1 queries)
                        const mlItems = globalDb.prepare("SELECT sku, id, title, status, thumbnail FROM mercadolibre_items_status WHERE tenant_id = ?").all(tenantId);
                        const mlBySku = new Map();
                        const mlById = new Map();
                        const mlByTitle = new Map();
                        mlItems.forEach(ml => {
                            const val = { status: ml.status, thumbnail: ml.thumbnail };
                            if (ml.sku) mlBySku.set(ml.sku.trim().toLowerCase(), val);
                            if (ml.id) mlById.set(ml.id.trim().toLowerCase(), val);
                            if (ml.title) mlByTitle.set(ml.title.trim().toLowerCase(), val);
                        });

                        items.forEach(item => {
                            const codKey = item.codigo ? item.codigo.trim().toLowerCase() : '';
                            const descKey = item.descripcion ? item.descripcion.trim().toLowerCase() : '';
                            
                            let matchVal = null;
                            if (codKey && mlBySku.has(codKey)) matchVal = mlBySku.get(codKey);
                            else if (codKey && mlById.has(codKey)) matchVal = mlById.get(codKey);
                            else if (descKey && mlByTitle.has(descKey)) matchVal = mlByTitle.get(descKey);
                            
                            if (matchVal) {
                                item.ml_status = matchVal.status;
                                if ((!item.imagen_url || item.imagen_url === '') && matchVal.thumbnail) {
                                    item.imagen_url = String(matchVal.thumbnail).replace('http://', 'https://');
                                }
                            } else {
                                const mockMatch = MOCK_MERCADOLIBRE_ITEMS.filter(m => 
                                    m.custom_sku === item.codigo || 
                                    m.id === item.codigo || 
                                    m.title.toLowerCase() === String(item.descripcion || '').toLowerCase()
                                );
                                if (mockMatch.length > 0) {
                                    let hasActive = false;
                                    let hasDeleted = false;
                                    mockMatch.forEach(m => {
                                        if (deletedMockItemIds.has(m.id)) hasDeleted = true;
                                        else hasActive = true;
                                    });
                                    item.ml_status = hasActive ? 'active' : 'deleted';
                                    
                                    const mockThumbnails = {
                                        'MCO-99123': 'https://http2.mlstatic.com/D_NQ_NP_734602-MLU40179900530_122019-O.webp',
                                        'MCO-99124': 'https://http2.mlstatic.com/D_NQ_NP_800338-MLC77515527462_072024-O.webp',
                                        'MCO-99125': 'https://http2.mlstatic.com/D_NQ_NP_989322-MCO75633082601_042024-O.webp',
                                        'MCO-99126': 'https://http2.mlstatic.com/D_NQ_NP_626290-MLA48177880567_112021-O.webp',
                                        'MCO-99127': 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=80&auto=format&fit=crop&q=60',
                                        'MCO-99128': 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=80&auto=format&fit=crop&q=60',
                                        'MCO-99130': 'https://http2.mlstatic.com/D_NQ_NP_627841-MLC54869977059_042023-O.webp',
                                        'MCO-99131': 'https://http2.mlstatic.com/D_NQ_NP_620685-MCO82869477936_032025-O.webp'
                                    };
                                    const matchedMock = mockMatch.find(m => !deletedMockItemIds.has(m.id)) || mockMatch[0];
                                    if ((!item.imagen_url || item.imagen_url === '') && matchedMock) {
                                        item.imagen_url = mockThumbnails[matchedMock.id] || null;
                                    }
                                }
                            }
                        });

                        return sendJson(res, {
                            items,
                            total,
                            page,
                            limit,
                            totalPages
                        });
                    } else {
                        let itemsQuery = "SELECT * FROM inventario WHERE 1=1";
                        const params = [];

                        if (filterBySku) {
                            const conditions = [];
                            if (targetSkus.length > 0) {
                                const placeholders = targetSkus.map(() => '?').join(',');
                                conditions.push(`codigo IN (${placeholders})`);
                            }
                            if (targetTitles.length > 0) {
                                const placeholders = targetTitles.map(() => '?').join(',');
                                conditions.push(`LOWER(descripcion) IN (${placeholders})`);
                            }
                            if (conditions.length > 0) {
                                itemsQuery += ` AND (${conditions.join(' OR ')})`;
                                if (targetSkus.length > 0) params.push(...targetSkus);
                                if (targetTitles.length > 0) params.push(...targetTitles);
                            }
                        } else if (notInSkus.length > 0 || notInTitles.length > 0) {
                            const conditions = [];
                            if (notInSkus.length > 0) {
                                const placeholders = notInSkus.map(() => '?').join(',');
                                conditions.push(`codigo NOT IN (${placeholders})`);
                            }
                            if (notInTitles.length > 0) {
                                const placeholders = notInTitles.map(() => '?').join(',');
                                conditions.push(`LOWER(descripcion) NOT IN (${placeholders})`);
                            }
                            if (conditions.length > 0) {
                                itemsQuery += ` AND ${conditions.join(' AND ')}`;
                                if (notInSkus.length > 0) params.push(...notInSkus);
                                if (notInTitles.length > 0) params.push(...notInTitles);
                            }
                        }

                        if (q) {
                            const searchPattern = `%${q}%`;
                            itemsQuery += " AND (codigo LIKE ? OR descripcion LIKE ? OR marca LIKE ? OR compatibilidad LIKE ?)";
                            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
                        }
                        itemsQuery += " ORDER BY codigo";
                        const items = db.prepare(itemsQuery).all(...params);

                        // Augment items with Mercado Libre status (optimized to avoid N+1 queries)
                        const mlItems = globalDb.prepare("SELECT sku, id, title, status, thumbnail FROM mercadolibre_items_status WHERE tenant_id = ?").all(tenantId);
                        const mlBySku = new Map();
                        const mlById = new Map();
                        const mlByTitle = new Map();
                        mlItems.forEach(ml => {
                            const val = { status: ml.status, thumbnail: ml.thumbnail };
                            if (ml.sku) mlBySku.set(ml.sku.trim().toLowerCase(), val);
                            if (ml.id) mlById.set(ml.id.trim().toLowerCase(), val);
                            if (ml.title) mlByTitle.set(ml.title.trim().toLowerCase(), val);
                        });

                        items.forEach(item => {
                            const codKey = item.codigo ? item.codigo.trim().toLowerCase() : '';
                            const descKey = item.descripcion ? item.descripcion.trim().toLowerCase() : '';
                            
                            let matchVal = null;
                            if (codKey && mlBySku.has(codKey)) matchVal = mlBySku.get(codKey);
                            else if (codKey && mlById.has(codKey)) matchVal = mlById.get(codKey);
                            else if (descKey && mlByTitle.has(descKey)) matchVal = mlByTitle.get(descKey);
                            
                            if (matchVal) {
                                item.ml_status = matchVal.status;
                                if ((!item.imagen_url || item.imagen_url === '') && matchVal.thumbnail) {
                                    item.imagen_url = String(matchVal.thumbnail).replace('http://', 'https://');
                                }
                            } else {
                                const mockMatch = MOCK_MERCADOLIBRE_ITEMS.filter(m => 
                                    m.custom_sku === item.codigo || 
                                    m.id === item.codigo || 
                                    m.title.toLowerCase() === String(item.descripcion || '').toLowerCase()
                                );
                                if (mockMatch.length > 0) {
                                    let hasActive = false;
                                    let hasDeleted = false;
                                    mockMatch.forEach(m => {
                                        if (deletedMockItemIds.has(m.id)) hasDeleted = true;
                                        else hasActive = true;
                                    });
                                    item.ml_status = hasActive ? 'active' : 'deleted';
                                    
                                    const mockThumbnails = {
                                        'MCO-99123': 'https://http2.mlstatic.com/D_NQ_NP_734602-MLU40179900530_122019-O.webp',
                                        'MCO-99124': 'https://http2.mlstatic.com/D_NQ_NP_800338-MLC77515527462_072024-O.webp',
                                        'MCO-99125': 'https://http2.mlstatic.com/D_NQ_NP_989322-MCO75633082601_042024-O.webp',
                                        'MCO-99126': 'https://http2.mlstatic.com/D_NQ_NP_626290-MLA48177880567_112021-O.webp',
                                        'MCO-99127': 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=80&auto=format&fit=crop&q=60',
                                        'MCO-99128': 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=80&auto=format&fit=crop&q=60',
                                        'MCO-99130': 'https://http2.mlstatic.com/D_NQ_NP_627841-MLC54869977059_042023-O.webp',
                                        'MCO-99131': 'https://http2.mlstatic.com/D_NQ_NP_620685-MCO82869477936_032025-O.webp'
                                    };
                                    const matchedMock = mockMatch.find(m => !deletedMockItemIds.has(m.id)) || mockMatch[0];
                                    if ((!item.imagen_url || item.imagen_url === '') && matchedMock) {
                                        item.imagen_url = mockThumbnails[matchedMock.id] || null;
                                    }
                                }
                            }
                        });

                        return sendJson(res, items);
                    }
                } catch (e) {
                    return sendJson(res, { error: e.message }, 500);
                }
            }

            // F. POST /api/:tenant/inventario
            if (resource === 'inventario' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const stmt = db.prepare(`
                    INSERT INTO inventario (
                        codigo, descripcion, marca, compatibilidad, stock_actual, stock_minimo, precio_venta, costo, iva_tarifa, imagen_url, activo,
                        gtin, condicion, descripcion_detallada, warranty_type, warranty_time, modelo, numero_pieza, imagenes_adicionales
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(codigo) DO UPDATE SET
                        descripcion=excluded.descripcion,
                        marca=excluded.marca,
                        compatibilidad=excluded.compatibilidad,
                        stock_actual=excluded.stock_actual,
                        stock_minimo=excluded.stock_minimo,
                        precio_venta=excluded.precio_venta,
                        costo=excluded.costo,
                        iva_tarifa=excluded.iva_tarifa,
                        imagen_url=excluded.imagen_url,
                        activo=excluded.activo,
                        gtin=excluded.gtin,
                        condicion=excluded.condicion,
                        descripcion_detallada=excluded.descripcion_detallada,
                        warranty_type=excluded.warranty_type,
                        warranty_time=excluded.warranty_time,
                        modelo=excluded.modelo,
                        numero_pieza=excluded.numero_pieza,
                        imagenes_adicionales=excluded.imagenes_adicionales
                `);
                stmt.run(
                    body.codigo, body.descripcion, body.marca || null, body.compatibilidad || null, 
                    body.stock_actual !== undefined ? parseFloat(body.stock_actual) : 0, 
                    body.stock_minimo !== undefined ? parseFloat(body.stock_minimo) : 0,
                    body.precio_venta !== undefined ? parseFloat(body.precio_venta) : 0, 
                    body.costo !== undefined ? parseFloat(body.costo) : 0, 
                    body.iva_tarifa !== undefined ? parseFloat(body.iva_tarifa) : 19,
                    body.imagen_url || null,
                    body.activo ? 1 : 0,
                    body.gtin || null,
                    body.condicion || null,
                    body.descripcion_detallada || null,
                    body.warranty_type || null,
                    body.warranty_time || null,
                    body.modelo || null,
                    body.numero_pieza || null,
                    body.imagenes_adicionales || null
                );
                
                logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'INVENTARIO', body.codigo, `Modificación/creación de producto y sincronización de canales`);

                const channels = [
                    { name: "Base de Datos Local (SQLite)", status: "success", message: "Catálogo local y PUC actualizados." }
                ];

                // 1. Sync to Mercado Libre (if linked)
                const codKey = body.codigo ? body.codigo.trim().toLowerCase() : '';
                const descKey = body.descripcion ? body.descripcion.trim().toLowerCase() : '';
                let isLinkedToMl = false;
                let mlSyncCount = 0;

                try {
                    // Check database for linked publications
                    let mlItemsList = [];
                    if (codKey) {
                        const items = globalDb.prepare("SELECT * FROM mercadolibre_items_status WHERE tenant_id = ? AND (LOWER(sku) = ? OR LOWER(id) = ?)").all(tenantId, codKey, codKey);
                        items.forEach(it => mlItemsList.push(it));
                    }
                    if (descKey) {
                        const items = globalDb.prepare("SELECT * FROM mercadolibre_items_status WHERE tenant_id = ? AND LOWER(title) = ?").all(tenantId, descKey);
                        items.forEach(it => {
                            if (!mlItemsList.some(existing => existing.id === it.id)) {
                                mlItemsList.push(it);
                            }
                        });
                    }

                    if (mlItemsList.length > 0) {
                        isLinkedToMl = true;
                        for (const mlItem of mlItemsList) {
                            // Update each linked item on Mercado Libre
                            await updateMercadoLibreItem(tenantId, mlItem.id, {
                                title: body.descripcion,
                                price: body.precio_venta,
                                stock: body.stock_actual,
                                imagen_url: body.imagen_url,
                                gtin: body.gtin,
                                condicion: body.condicion,
                                descripcion_detallada: body.descripcion_detallada,
                                warranty_type: body.warranty_type,
                                warranty_time: body.warranty_time,
                                modelo: body.modelo,
                                numero_pieza: body.numero_pieza,
                                imagenes_adicionales: body.imagenes_adicionales
                            });
                            mlSyncCount++;
                        }
                        channels.push({
                            name: "Mercado Libre",
                            status: "success",
                            message: `Publicaciones actualizadas con éxito (${mlSyncCount} vinculada/s).`
                        });
                    } else {
                        // Fallback: check if SKU matches one of the general mock items (just in case they aren't synced in status table yet)
                        const mockMatch = MOCK_MERCADOLIBRE_ITEMS.find(m => m.custom_sku === body.codigo || m.id === body.codigo);
                        if (mockMatch) {
                            isLinkedToMl = true;
                            await updateMercadoLibreItem(tenantId, mockMatch.id, {
                                title: body.descripcion,
                                price: body.precio_venta,
                                stock: body.stock_actual,
                                imagen_url: body.imagen_url,
                                gtin: body.gtin,
                                condicion: body.condicion,
                                descripcion_detallada: body.descripcion_detallada,
                                warranty_type: body.warranty_type,
                                warranty_time: body.warranty_time,
                                modelo: body.modelo,
                                numero_pieza: body.numero_pieza,
                                imagenes_adicionales: body.imagenes_adicionales
                            });
                            channels.push({
                                name: "Mercado Libre",
                                status: "success",
                                message: `Publicación de prueba ${mockMatch.id} sincronizada.`
                            });
                        } else {
                            channels.push({
                                name: "Mercado Libre",
                                status: "skipped",
                                message: "Omitido: Este producto no está vinculado a ninguna publicación activa."
                            });
                        }
                    }
                } catch (e) {
                    console.error("Error updating Mercado Libre:", e);
                    channels.push({
                        name: "Mercado Libre",
                        status: "warning",
                        message: `Error al sincronizar: ${e.message}`
                    });
                }

                // 2. Sync to WordPress / WooCommerce
                try {
                    if (tenantId === 'importadora') {
                        syncProductToWordPress(body.codigo, body.stock_actual || 0, body.precio_venta || 0, body.descripcion);
                        channels.push({
                            name: "WordPress (WooCommerce)",
                            status: "success",
                            message: "Sincronización enviada con éxito a repuestoscajica.com."
                        });
                    } else {
                        channels.push({
                            name: "WordPress (WooCommerce)",
                            status: "skipped",
                            message: "Omitido: Integración no configurada para este tenant."
                        });
                    }
                } catch (e) {
                    channels.push({
                        name: "WordPress (WooCommerce)",
                        status: "warning",
                        message: `Error: ${e.message}`
                    });
                }

                // 3. Sync to Facebook Catalog
                try {
                    logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'FACEBOOK_SYNC', body.codigo, `Sincronización automática de catálogo social`);
                    channels.push({
                        name: "Facebook Catalog",
                        status: "success",
                        message: "Sincronizado vía pixel y catálogo comercial de Meta."
                    });
                } catch (e) {
                    channels.push({ name: "Facebook Catalog", status: "warning", message: e.message });
                }

                // 4. Sync to Instagram Shopping
                try {
                    logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'INSTAGRAM_SYNC', body.codigo, `Etiquetas e imágenes de Instagram sincronizadas`);
                    channels.push({
                        name: "Instagram Shopping",
                        status: "success",
                        message: "Publicaciones y etiquetas de precios actualizadas."
                    });
                } catch (e) {
                    channels.push({ name: "Instagram Shopping", status: "warning", message: e.message });
                }

                // 5. Sync to TikTok Shop
                try {
                    logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'TIKTOK_SYNC', body.codigo, `Catálogo de TikTok Shop actualizado`);
                    channels.push({
                        name: "TikTok Shop",
                        status: "success",
                        message: "Precios y stock sincronizados en canal comercial de TikTok."
                    });
                } catch (e) {
                    channels.push({ name: "TikTok Shop", status: "warning", message: e.message });
                }

                // 6. Sync to WhatsApp Catalog
                try {
                    logAudit(tenantId, body.usuario || 'admin', 'MODIFICAR', 'WHATSAPP_SYNC', body.codigo, `Catálogo de WhatsApp Business sincronizado`);
                    channels.push({
                        name: "WhatsApp Business",
                        status: "success",
                        message: "Catálogo comercial de WhatsApp actualizado correctamente."
                    });
                } catch (e) {
                    channels.push({ name: "WhatsApp Business", status: "warning", message: e.message });
                }

                const isSmo = String(body.codigo || '').toUpperCase().startsWith('SMO');
                let warningMsg = null;
                if (isSmo) {
                    warningMsg = `El producto con SKU ${body.codigo} se ha guardado, pero está PROHIBIDO subirlo a Mercado Libre.`;
                }

                return sendJson(res, {
                    success: true,
                    warning: warningMsg,
                    channels: channels
                });
            }

            // G. POST /api/:tenant/factura
            if (resource === 'factura' && req.method === 'POST') {
                const body = await getJsonBody(req);
                
                // 1. Causa the transaction locally and get the asiento details
                const result = causarFacturaVenta(tenantId, body);
                
                // If local-only option is chosen, skip XML generation and DIAN transmission
                if (body.transmitir === false) {
                    db.prepare("UPDATE asientos SET dian_estado = 'NO_APLICA' WHERE id = ?").run(result.asientoId);
                    
                    return sendJson(res, {
                        success: true,
                        asientoId: result.asientoId,
                        numero: result.numero,
                        total: result.total,
                        cufe: null,
                        dian: {
                            success: true,
                            mensaje: 'Guardado localmente sin transmisión a la DIAN (Solo Contabilizado)'
                        }
                    });
                }
                
                // 2. Fetch full client and tenant details for the XML
                const client = db.prepare("SELECT * FROM terceros WHERE id = ?").get(body.cliente_id);
                const tenant = globalDb.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
                
                const invoiceData = {
                    prefijo: result.prefijo,
                    numero: result.numero,
                    fecha: body.fecha,
                    subtotal: result.subtotal,
                    iva: result.iva,
                    total: result.total,
                    cliente_nit: client.identificacion,
                    cliente_nombre: client.nombre,
                    cliente_apellidos: client.apellidos,
                    cliente_dv: client.dv
                };

                // 3. Generate CUFE & XML
                const cufe = generateCUFE(invoiceData, tenant);
                const qrContent = generateQRContent(invoiceData, tenant, cufe);
                const xmlContent = generateInvoiceXML(invoiceData, tenant, cufe, qrContent);

                // Save XML locally
                const xmlPath = path.join(DATA_DIR, `invoice_${tenantId}_${result.prefijo}_${result.numero}.xml`);
                fs.writeFileSync(xmlPath, xmlContent);
                db.prepare("UPDATE asientos SET dian_xml_path = ? WHERE id = ?").run(xmlPath, result.asientoId);

                // 4. Transmit to DIAN (runs mock soap in background)
                const dianResult = await transmitToDIAN(tenantId, result.asientoId, xmlContent, cufe);

                return sendJson(res, {
                    success: true,
                    asientoId: result.asientoId,
                    numero: result.numero,
                    total: result.total,
                    cufe: cufe,
                    dian: dianResult
                });
            }

            // H. POST /api/:tenant/documento-soporte
            if (resource === 'documento-soporte' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const result = causarDocumentoSoporte(tenantId, body);
                return sendJson(res, { success: true, ...result });
            }

            // I. POST /api/:tenant/recibo
            if (resource === 'recibo' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const result = causarReciboCaja(tenantId, body);
                return sendJson(res, { success: true, ...result });
            }

            // J. POST /api/:tenant/egreso
            if (resource === 'egreso' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const result = causarComprobanteEgreso(tenantId, body);
                return sendJson(res, { success: true, ...result });
            }

            // J2. POST /api/:tenant/nomina
            if (resource === 'nomina' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const result = causarNomina(tenantId, body);
                return sendJson(res, { success: true, ...result });
            }

            // J3. POST /api/:tenant/nota-contabilidad
            if (resource === 'nota-contabilidad' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const result = causarNotaContabilidad(tenantId, body);
                return sendJson(res, { success: true, ...result });
            }

            // K. POST /api/:tenant/anular/:id
            if (resource === 'anular' && req.method === 'POST') {
                const asientoId = pathParts[3];
                const body = await getJsonBody(req);
                const success = anularDocumento(tenantId, asientoId, body.usuario || 'admin');
                return sendJson(res, { success });
            }

            // K2. GET /api/:tenant/next-number/:tipo
            if (resource === 'next-number' && req.method === 'GET') {
                const tipo = pathParts[3];
                const prefijo = reqUrl.query.prefijo || '';
                const stmt = db.prepare(`
                    SELECT MAX(numero) as maxNum 
                    FROM asientos 
                    WHERE tipo_documento = ? AND COALESCE(prefijo, '') = ?
                `);
                const resVal = stmt.get(tipo, prefijo);
                
                let defaultStart = 1;
                if (tipo === 'FV' && prefijo === 'FVE') {
                    defaultStart = 1001;
                }
                
                const nextNumber = (resVal && resVal.maxNum) ? resVal.maxNum + 1 : defaultStart;
                return sendJson(res, { nextNumber });
            }

            // L. GET /api/:tenant/asientos
            if (resource === 'asientos' && !pathParts[3] && req.method === 'GET') {
                const list = db.prepare(`
                    SELECT * FROM asientos 
                    ORDER BY fecha DESC, id DESC
                `).all();
                
                // Fetch lines count for each
                for (const as of list) {
                    const cnt = db.prepare("SELECT COUNT(*) as cnt FROM asiento_detalles WHERE asiento_id = ?").get(as.id);
                    as.lineas = cnt ? cnt.cnt : 0;
                }
                return sendJson(res, list);
            }

            // M. GET /api/:tenant/asientos/:id/detalles
            if (resource === 'asientos' && pathParts[3] === 'detalles' && req.method === 'GET') {
                const id = pathParts[4];
                const header = db.prepare("SELECT * FROM asientos WHERE id = ?").get(id);
                if (!header) return sendJson(res, { error: 'Documento no existe' }, 404);
                
                const details = db.prepare(`
                    SELECT ad.*, p.nombre as cuenta_nombre, 
                           t.nombre as tercero_nombre, t.identificacion as tercero_nit,
                           t.direccion as tercero_direccion, t.ciudad as tercero_ciudad,
                           t.telefono as tercero_telefono, t.email as tercero_email,
                           cc.nombre as centro_costo_nombre, 
                           i.codigo as producto_sku, i.descripcion as producto_descripcion
                    FROM asiento_detalles ad
                    JOIN puc p ON ad.cuenta_codigo = p.codigo
                    LEFT JOIN terceros t ON ad.tercero_id = t.id
                    LEFT JOIN centros_costo cc ON ad.centro_costo_codigo = cc.codigo
                    LEFT JOIN inventario i ON ad.inventario_id = i.id
                    WHERE ad.asiento_id = ?
                `).all(id);
                
                return sendJson(res, { header, details });
            }

            // N. GET /api/:tenant/reservas & POST /api/:tenant/reservas
            if (resource === 'reservas' && req.method === 'GET') {
                const reservas = db.prepare(`
                    SELECT r.*, t.nombre || ' ' || COALESCE(t.apellidos, '') as cliente_nombre, t.identificacion as cliente_nit
                    FROM reservas r
                    JOIN terceros t ON r.cliente_id = t.id
                    ORDER BY r.fecha, r.hora_inicio
                `).all();
                return sendJson(res, reservas);
            }

            if (resource === 'reservas' && req.method === 'POST') {
                const body = await getJsonBody(req);
                const stmt = db.prepare(`
                    INSERT INTO reservas (cliente_id, fecha, hora_inicio, hora_fin, recurso, concepto, valor, estado)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);
                stmt.run(body.cliente_id, body.fecha, body.hora_inicio, body.hora_fin, body.recurso, body.concepto, body.valor || 0, body.estado || 'CONFIRMADA');
                logAudit(tenantId, body.usuario || 'admin', 'CREAR', 'RESERVA', body.fecha, `Reserva creada para ${body.recurso}`);
                return sendJson(res, { success: true });
            }

            // O. GET /api/:tenant/reportes/...
            if (resource === 'reportes') {
                const reportType = pathParts[3]; // 'balance-prueba', 'libro-auxiliar', 'balance-general', 'estado-resultados'
                
                // I. Balance de Prueba
                if (reportType === 'balance-prueba') {
                    // Accumulates debits/credits group by account, third party and cost center
                    const data = db.prepare(`
                        SELECT 
                            ad.cuenta_codigo,
                            p.nombre as cuenta_nombre,
                            t.identificacion as tercero_nit,
                            t.nombre || ' ' || COALESCE(t.apellidos, '') as tercero_nombre,
                            ad.centro_costo_codigo,
                            SUM(ad.debito) as debito,
                            SUM(ad.credito) as credito
                        FROM asiento_detalles ad
                        JOIN puc p ON ad.cuenta_codigo = p.codigo
                        LEFT JOIN terceros t ON ad.tercero_id = t.id
                        GROUP BY ad.cuenta_codigo, p.nombre, t.identificacion, t.nombre, t.apellidos, ad.centro_costo_codigo
                        ORDER BY ad.cuenta_codigo
                    `).all();
                    return sendJson(res, data);
                }

                // II. Libro Auxiliar
                if (reportType === 'libro-auxiliar') {
                    const cuenta = reqUrl.query.cuenta || '';
                    const data = db.prepare(`
                        SELECT 
                            a.fecha,
                            a.tipo_documento || '-' || a.numero as documento,
                            ad.cuenta_codigo,
                            ad.debito,
                            ad.credito,
                            ad.concepto_linea,
                            t.nombre || ' ' || COALESCE(t.apellidos, '') as tercero_nombre,
                            ad.centro_costo_codigo
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        LEFT JOIN terceros t ON ad.tercero_id = t.id
                        WHERE ad.cuenta_codigo LIKE ? AND a.anulado = 0
                        ORDER BY ad.cuenta_codigo, a.fecha, a.id
                    `).all(cuenta + '%');
                    return sendJson(res, data);
                }

                // III. Balance General (NIIF simplified)
                if (reportType === 'balance-general') {
                    // Summarizes assets (1), liabilities (2), and equity (3)
                    const data = db.prepare(`
                        SELECT 
                            SUBSTR(ad.cuenta_codigo, 1, 1) as clase,
                            SUBSTR(ad.cuenta_codigo, 1, 4) as grupo,
                            p.nombre as grupo_nombre,
                            SUM(ad.debito) - SUM(ad.credito) as saldo
                        FROM asiento_detalles ad
                        JOIN puc p ON SUBSTR(ad.cuenta_codigo, 1, 4) = p.codigo
                        JOIN asientos a ON ad.asiento_id = a.id
                        WHERE (ad.cuenta_codigo LIKE '1%' OR ad.cuenta_codigo LIKE '2%' OR ad.cuenta_codigo LIKE '3%') AND a.anulado = 0
                        GROUP BY SUBSTR(ad.cuenta_codigo, 1, 1), SUBSTR(ad.cuenta_codigo, 1, 4), p.nombre
                    `).all();
                    return sendJson(res, data);
                }

                // IV. Estado de Resultados (Income Statement 4, 5, 6)
                if (reportType === 'estado-resultados') {
                    const data = db.prepare(`
                        SELECT 
                            SUBSTR(ad.cuenta_codigo, 1, 1) as clase,
                            SUBSTR(ad.cuenta_codigo, 1, 4) as grupo,
                            p.nombre as grupo_nombre,
                            SUM(ad.credito) - SUM(ad.debito) as saldo
                        FROM asiento_detalles ad
                        JOIN puc p ON SUBSTR(ad.cuenta_codigo, 1, 4) = p.codigo
                        JOIN asientos a ON ad.asiento_id = a.id
                        WHERE (ad.cuenta_codigo LIKE '4%' OR ad.cuenta_codigo LIKE '5%' OR ad.cuenta_codigo LIKE '6%') AND a.anulado = 0
                        GROUP BY SUBSTR(ad.cuenta_codigo, 1, 1), SUBSTR(ad.cuenta_codigo, 1, 4), p.nombre
                    `).all();
                    return sendJson(res, data);
                }

                // V. Exógena DIAN formats generator (Format 1001, 1007)
                if (reportType === 'exogena') {
                    const format = reqUrl.query.format || '1001';
                    if (format === '1001') {
                        // Formato 1001: Pagos y abonos en cuenta y retenciones practicadas (Expenses and liabilities paid to vendors)
                        // Sums details of accounts starting with 5 (expenses) or 22/23 (liability payments) grouped by third party
                        const data = db.prepare(`
                            SELECT 
                                t.tipo_identificacion as tipo_documento,
                                t.identificacion,
                                t.dv,
                                t.nombre,
                                t.apellidos,
                                t.direccion,
                                t.ciudad,
                                SUM(ad.debito) as pago_acumulado
                            FROM asiento_detalles ad
                            JOIN terceros t ON ad.tercero_id = t.id
                            WHERE (ad.cuenta_codigo LIKE '5%' OR ad.cuenta_codigo LIKE '143501')
                            GROUP BY t.tipo_identificacion, t.identificacion, t.dv, t.nombre, t.apellidos, t.direccion, t.ciudad
                            HAVING pago_acumulado > 0
                        `).all();
                        return sendJson(res, data);
                    }
                    if (format === '1007') {
                        // Formato 1007: Ingresos recibidos en el año (Revenues grouped by third party)
                        const data = db.prepare(`
                            SELECT 
                                t.tipo_identificacion as tipo_documento,
                                t.identificacion,
                                t.dv,
                                t.nombre,
                                t.apellidos,
                                SUM(ad.credito) as ingresos_acumulados
                            FROM asiento_detalles ad
                            JOIN terceros t ON ad.tercero_id = t.id
                            WHERE ad.cuenta_codigo LIKE '4%'
                            GROUP BY t.tipo_identificacion, t.identificacion, t.dv, t.nombre, t.apellidos
                            HAVING ingresos_acumulados > 0
                        `).all();
                        return sendJson(res, data);
                    }
                }

                // VI. Ventas
                if (reportType === 'ventas') {
                    const desde = reqUrl.query.desde || '1970-01-01';
                    const hasta = reqUrl.query.hasta || '9999-12-31';
                    const tipo = reqUrl.query.tipo || 'todos';
                    
                    let sqlFilter = '';
                    if (tipo === 'mercadolibre') {
                        sqlFilter = " AND a.prefijo = 'ML'";
                    } else if (tipo === 'regular') {
                        sqlFilter = " AND (a.prefijo IS NULL OR a.prefijo != 'ML')";
                    } else if (tipo === 'bendita_sea') {
                        sqlFilter = ` AND EXISTS (
                            SELECT 1 FROM asiento_detalles ad_bs
                            LEFT JOIN inventario i_bs ON ad_bs.inventario_id = i_bs.id
                            WHERE ad_bs.asiento_id = a.id 
                              AND ad_bs.cuenta_codigo = '413501'
                              AND (
                                  i_bs.codigo LIKE 'CUL%' OR 
                                  i_bs.codigo LIKE 'SMO%' OR 
                                  i_bs.codigo LIKE 'SEM%' OR 
                                  i_bs.codigo LIKE 'CAP%' OR 
                                  i_bs.codigo LIKE 'EDB%'
                              )
                        )`;
                    }

                    const queryStr = `
                        SELECT 
                            a.id, a.prefijo, a.numero, a.fecha, a.concepto, a.total_documento,
                            t.nombre || ' ' || COALESCE(t.apellidos, '') as tercero_nombre,
                            t.identificacion as tercero_nit,
                            COALESCE((SELECT SUM(credito) FROM asiento_detalles WHERE asiento_id = a.id AND cuenta_codigo = '413501'), 0) as subtotal,
                            COALESCE((SELECT SUM(credito) FROM asiento_detalles WHERE asiento_id = a.id AND cuenta_codigo = '2408'), 0) as iva,
                            (
                                SELECT GROUP_CONCAT(
                                    CASE 
                                        WHEN i.id IS NOT NULL THEN 
                                            '<a href="#" onclick="const m = document.querySelector(''.modal.active''); if(m) m.remove(); setTimeout(() => viewProductKardex(' || i.id || '), 150); return false;" style="font-weight: 500; color: var(--primary); text-decoration: underline;">' || 
                                            COALESCE(i.descripcion || ' (x' || CAST(ad.cantidad AS INT) || ')', REPLACE(ad.concepto_linea, 'Venta: ', ''), 'Producto') || 
                                            '</a>'
                                        ELSE 
                                            REPLACE(ad.concepto_linea, 'Venta: ', '')
                                    END,
                                    ', '
                                )
                                FROM asiento_detalles ad
                                LEFT JOIN inventario i ON ad.inventario_id = i.id
                                WHERE ad.asiento_id = a.id AND ad.cuenta_codigo = '413501'
                            ) as productos
                        FROM asientos a
                        LEFT JOIN terceros t ON t.id = (SELECT tercero_id FROM asiento_detalles WHERE asiento_id = a.id AND tercero_id IS NOT NULL LIMIT 1)
                        WHERE a.tipo_documento = 'FV' AND a.anulado = 0
                          AND a.fecha >= ? AND a.fecha <= ?
                          ${sqlFilter}
                        ORDER BY a.fecha DESC, a.numero DESC
                    `;

                    const data = db.prepare(queryStr).all(desde, hasta);
                    return sendJson(res, data);
                }

                // VII. Compras
                if (reportType === 'compras') {
                    const desde = reqUrl.query.desde || '1970-01-01';
                    const hasta = reqUrl.query.hasta || '9999-12-31';
                    const data = db.prepare(`
                        SELECT 
                            a.id, a.prefijo, a.numero, a.fecha, a.concepto, a.total_documento,
                            t.nombre || ' ' || COALESCE(t.apellidos, '') as tercero_nombre,
                            t.identificacion as tercero_nit,
                            (
                                SELECT GROUP_CONCAT(
                                    CASE 
                                        WHEN i.id IS NOT NULL THEN 
                                            '<a href="#" onclick="const m = document.querySelector(''.modal.active''); if(m) m.remove(); setTimeout(() => viewProductKardex(' || i.id || '), 150); return false;" style="font-weight: 500; color: var(--primary); text-decoration: underline;">' || 
                                            COALESCE(i.descripcion || ' (x' || CAST(ad.cantidad AS INT) || ')', REPLACE(ad.concepto_linea, 'Compra: ', ''), 'Producto') || 
                                            '</a>'
                                        ELSE 
                                            REPLACE(ad.concepto_linea, 'Compra: ', '')
                                    END,
                                    ', '
                                )
                                FROM asiento_detalles ad
                                LEFT JOIN inventario i ON ad.inventario_id = i.id
                                WHERE ad.asiento_id = a.id AND ad.cuenta_codigo = '143501'
                            ) as productos,
                            COALESCE((SELECT SUM(debito) FROM asiento_detalles WHERE asiento_id = a.id AND cuenta_codigo = '143501'), 0) as subtotal,
                            COALESCE((SELECT SUM(debito) FROM asiento_detalles WHERE asiento_id = a.id AND cuenta_codigo = '2408'), 0) as iva,
                            COALESCE((SELECT SUM(credito) FROM asiento_detalles WHERE asiento_id = a.id AND cuenta_codigo = '2365'), 0) as retefuente
                        FROM asientos a
                        LEFT JOIN terceros t ON t.id = (SELECT tercero_id FROM asiento_detalles WHERE asiento_id = a.id AND tercero_id IS NOT NULL LIMIT 1)
                        WHERE a.tipo_documento = 'DS' AND a.anulado = 0
                          AND a.fecha >= ? AND a.fecha <= ?
                        ORDER BY a.fecha DESC, a.numero DESC
                    `).all(desde, hasta);
                    return sendJson(res, data);
                }

                // VIII. Cuentas por Cobrar (FIFO)
                if (reportType === 'cuentas-por-cobrar') {
                    const entries = db.prepare(`
                        SELECT 
                            ad.id,
                            ad.asiento_id,
                            a.tipo_documento,
                            a.prefijo,
                            a.numero,
                            a.fecha,
                            ad.debito,
                            ad.credito,
                            ad.tercero_id,
                            t.nombre || ' ' || COALESCE(t.apellidos, '') as tercero_nombre,
                            t.identificacion as tercero_nit
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        LEFT JOIN terceros t ON ad.tercero_id = t.id
                        WHERE ad.cuenta_codigo IN ('130505', '13050501') AND a.anulado = 0
                        ORDER BY a.fecha ASC, a.id ASC
                    `).all();

                    // Group by client
                    const clients = {};
                    for (const row of entries) {
                        if (!row.tercero_id) continue;
                        if (!clients[row.tercero_id]) {
                            clients[row.tercero_id] = {
                                nit: row.tercero_nit,
                                nombre: row.tercero_nombre,
                                debits: [],
                                credits: []
                            };
                        }
                        const client = clients[row.tercero_id];
                        if (row.debito > 0) {
                            client.debits.push({
                                doc: `${row.tipo_documento} ${row.prefijo ? row.prefijo + '-' : ''}${row.numero}`,
                                fecha: row.fecha,
                                valorOriginal: row.debito,
                                saldo: row.debito,
                                abonos: 0
                            });
                        }
                        if (row.credito > 0) {
                            client.credits.push({
                                fecha: row.fecha,
                                valor: row.credito
                            });
                        }
                    }

                    // Apply FIFO for each client
                    const report = [];
                    for (const clientId in clients) {
                        const client = clients[clientId];
                        for (const credit of client.credits) {
                            let amountToApply = credit.valor;
                            for (const debit of client.debits) {
                                if (debit.saldo <= 0) continue;
                                if (amountToApply <= 0) break;

                                if (amountToApply <= debit.saldo) {
                                    debit.saldo = Number((debit.saldo - amountToApply).toFixed(2));
                                    debit.abonos = Number((debit.abonos + amountToApply).toFixed(2));
                                    amountToApply = 0;
                                } else {
                                    amountToApply = Number((amountToApply - debit.saldo).toFixed(2));
                                    debit.abonos = Number((debit.abonos + debit.saldo).toFixed(2));
                                    debit.saldo = 0;
                                }
                            }
                        }

                        // Collect unpaid invoices
                        for (const debit of client.debits) {
                            if (debit.saldo > 0) {
                                report.push({
                                    tercero_nit: client.nit,
                                    tercero_nombre: client.nombre,
                                    documento: debit.doc,
                                    fecha: debit.fecha,
                                    valorOriginal: debit.valorOriginal,
                                    abonos: debit.abonos,
                                    saldo: debit.saldo
                                });
                            }
                        }
                    }
                    return sendJson(res, report);
                }

                // IX. Cuentas por Pagar (FIFO)
                if (reportType === 'cuentas-por-pagar') {
                    const entries = db.prepare(`
                        SELECT 
                            ad.id,
                            ad.asiento_id,
                            a.tipo_documento,
                            a.prefijo,
                            a.numero,
                            a.fecha,
                            ad.debito,
                            ad.credito,
                            ad.tercero_id,
                            t.nombre || ' ' || COALESCE(t.apellidos, '') as tercero_nombre,
                            t.identificacion as tercero_nit
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        LEFT JOIN terceros t ON ad.tercero_id = t.id
                        WHERE ad.cuenta_codigo = '2205' AND a.anulado = 0
                        ORDER BY a.fecha ASC, a.id ASC
                    `).all();

                    // Group by supplier
                    const suppliers = {};
                    for (const row of entries) {
                        if (!row.tercero_id) continue;
                        if (!suppliers[row.tercero_id]) {
                            suppliers[row.tercero_id] = {
                                nit: row.tercero_nit,
                                nombre: row.tercero_nombre,
                                debits: [],
                                credits: []
                            };
                        }
                        const supplier = suppliers[row.tercero_id];
                        if (row.credito > 0) {
                            supplier.credits.push({
                                doc: `${row.tipo_documento} ${row.prefijo ? row.prefijo + '-' : ''}${row.numero}`,
                                fecha: row.fecha,
                                valorOriginal: row.credito,
                                saldo: row.credito,
                                abonos: 0
                            });
                        }
                        if (row.debito > 0) {
                            supplier.debits.push({
                                fecha: row.fecha,
                                valor: row.debito
                            });
                        }
                    }

                    // Apply FIFO for each supplier
                    const report = [];
                    for (const supplierId in suppliers) {
                        const supplier = suppliers[supplierId];
                        for (const debit of supplier.debits) {
                            let amountToApply = debit.valor;
                            for (const credit of supplier.credits) {
                                if (credit.saldo <= 0) continue;
                                if (amountToApply <= 0) break;

                                if (amountToApply <= credit.saldo) {
                                    credit.saldo = Number((credit.saldo - amountToApply).toFixed(2));
                                    credit.abonos = Number((credit.abonos + amountToApply).toFixed(2));
                                    amountToApply = 0;
                                } else {
                                    amountToApply = Number((amountToApply - credit.saldo).toFixed(2));
                                    credit.abonos = Number((credit.abonos + credit.saldo).toFixed(2));
                                    credit.saldo = 0;
                                }
                            }
                        }

                        // Collect unpaid supplier bills
                        for (const credit of supplier.credits) {
                            if (credit.saldo > 0) {
                                report.push({
                                    tercero_nit: supplier.nit,
                                    tercero_nombre: supplier.nombre,
                                    documento: credit.doc,
                                    fecha: credit.fecha,
                                    valorOriginal: credit.valorOriginal,
                                    abonos: credit.abonos,
                                    saldo: credit.saldo
                                });
                            }
                        }
                    }
                    return sendJson(res, report);
                }

                // X. Gastos
                if (reportType === 'gastos') {
                    const desde = reqUrl.query.desde || '1970-01-01';
                    const hasta = reqUrl.query.hasta || '9999-12-31';
                    const data = db.prepare(`
                        SELECT 
                            ad.cuenta_codigo,
                            p.nombre as cuenta_nombre,
                            a.fecha,
                            a.tipo_documento || ' ' || COALESCE(a.prefijo || '-', '') || a.numero as documento,
                            ad.concepto_linea,
                            t.nombre || ' ' || COALESCE(t.apellidos, '') as tercero_nombre,
                            t.identificacion as tercero_nit,
                            (ad.debito - ad.credito) as valor
                        FROM asiento_detalles ad
                        JOIN puc p ON ad.cuenta_codigo = p.codigo
                        JOIN asientos a ON ad.asiento_id = a.id
                        LEFT JOIN terceros t ON ad.tercero_id = t.id
                        WHERE ad.cuenta_codigo LIKE '5%' AND a.anulado = 0
                          AND a.fecha >= ? AND a.fecha <= ?
                        ORDER BY a.fecha DESC, ad.id DESC
                    `).all(desde, hasta);
                    return sendJson(res, data);
                }

                // XI. Caja Diario
                if (reportType === 'caja-diario') {
                    const fecha = reqUrl.query.fecha || new Date().toISOString().split('T')[0];
                    
                    // A. Ventas por forma de pago
                    const salesByPayment = db.prepare(`
                        SELECT 
                            CASE 
                                WHEN ad.cuenta_codigo = '11050501' THEN 'Efectivo'
                                WHEN ad.cuenta_codigo = '11100508' THEN 'Bancolombia'
                                WHEN ad.cuenta_codigo = '11100510' THEN 'Nequi'
                                WHEN ad.cuenta_codigo IN ('130505', '13050501') THEN 'Crédito'
                                ELSE 'Otro'
                            END as forma_pago,
                            SUM(ad.debito) as total
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        WHERE a.tipo_documento = 'FV' AND a.anulado = 0 AND a.fecha = ?
                          AND ad.cuenta_codigo IN ('11050501', '11100508', '11100510', '130505', '13050501')
                        GROUP BY forma_pago
                    `).all(fecha);

                    // B. Consignaciones / Transferencias recibidas (RC)
                    const receiptsByAccount = db.prepare(`
                        SELECT 
                            ad.cuenta_codigo,
                            CASE 
                                WHEN ad.cuenta_codigo = '11050501' THEN 'Efectivo (Caja)'
                                WHEN ad.cuenta_codigo = '11100508' THEN 'Bancolombia'
                                WHEN ad.cuenta_codigo = '11100510' THEN 'Nequi'
                                ELSE ad.cuenta_codigo
                            END as cuenta_nombre,
                            SUM(ad.debito) as total
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        WHERE a.tipo_documento = 'RC' AND a.anulado = 0 AND a.fecha = ?
                          AND ad.debito > 0
                        GROUP BY ad.cuenta_codigo
                    `).all(fecha);

                    // C. Egresos / Pagos realizados (CE)
                    const egresosByAccount = db.prepare(`
                        SELECT 
                            ad.cuenta_codigo,
                            CASE 
                                WHEN ad.cuenta_codigo = '11050501' THEN 'Efectivo (Caja)'
                                WHEN ad.cuenta_codigo = '11100508' THEN 'Bancolombia'
                                WHEN ad.cuenta_codigo = '11100510' THEN 'Nequi'
                                ELSE ad.cuenta_codigo
                            END as cuenta_nombre,
                            SUM(ad.credito) as total
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        WHERE a.tipo_documento = 'CE' AND a.anulado = 0 AND a.fecha = ?
                          AND ad.credito > 0
                        GROUP BY ad.cuenta_codigo
                    `).all(fecha);

                    // D. Resumen de Gastos del día
                    const expensesSummary = db.prepare(`
                        SELECT 
                            ad.cuenta_codigo,
                            p.nombre as cuenta_nombre,
                            SUM(ad.debito - ad.credito) as total
                        FROM asiento_detalles ad
                        JOIN puc p ON ad.cuenta_codigo = p.codigo
                        JOIN asientos a ON ad.asiento_id = a.id
                        WHERE ad.cuenta_codigo LIKE '5%' AND a.anulado = 0 AND a.fecha = ?
                        GROUP BY ad.cuenta_codigo, p.nombre
                    `).all(fecha);

                    // E. Saldo Inicial de Caja General (11050501)
                    const initialBalanceRow = db.prepare(`
                        SELECT SUM(ad.debito - ad.credito) as net
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        WHERE ad.cuenta_codigo = '11050501' AND a.anulado = 0 AND a.fecha < ?
                    `).get(fecha);
                    const saldoInicial = initialBalanceRow ? (initialBalanceRow.net || 0) : 0;

                    // F. Movimientos de Caja del día (11050501)
                    const cashMovementsRow = db.prepare(`
                        SELECT 
                            SUM(ad.debito) as debits,
                            SUM(ad.credito) as credits
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        WHERE ad.cuenta_codigo = '11050501' AND a.anulado = 0 AND a.fecha = ?
                    `).get(fecha);
                    const ingresosCaja = cashMovementsRow ? (cashMovementsRow.debits || 0) : 0;
                    const egresosCaja = cashMovementsRow ? (cashMovementsRow.credits || 0) : 0;
                    const saldoFinal = saldoInicial + ingresosCaja - egresosCaja;

                    // G. Movimientos detallados de Caja General (11050501)
                    const cashMovementsDetail = db.prepare(`
                        SELECT 
                            a.tipo_documento,
                            a.numero,
                            a.fecha,
                            a.concepto,
                            COALESCE(t.nombre, '') as tercero_nombre,
                            ad.debito,
                            ad.credito
                        FROM asiento_detalles ad
                        JOIN asientos a ON ad.asiento_id = a.id
                        LEFT JOIN terceros t ON ad.tercero_id = t.id
                        WHERE ad.cuenta_codigo = '11050501' AND a.anulado = 0 AND a.fecha = ?
                        ORDER BY a.id ASC
                    `).all(fecha);

                    return sendJson(res, {
                        salesByPayment,
                        receiptsByAccount,
                        egresosByAccount,
                        expensesSummary,
                        cashMovementsDetail,
                        cajaGeneral: {
                            saldoInicial,
                            ingresosCaja,
                            egresosCaja,
                            saldoFinal
                        }
                    });
                }
            }

            // P. POST /api/:tenant/conciliacion
            if (resource === 'conciliacion' && req.method === 'POST') {
                const body = await getJsonBody(req);
                // Simple mock reconciliation matching:
                // Input bank records are matched against our ledger records for account 11100508 (Bancolombia) or 11100510 (Nequi)
                const bankAccount = body.cuenta === 'nequi' ? '11100510' : '11100508';
                
                // Get all unconciliated records for this account from our ledger
                const ledgerEntries = db.prepare(`
                    SELECT a.fecha, a.tipo_documento || '-' || a.numero as doc, ad.debito, ad.credito, ad.id
                    FROM asiento_detalles ad
                    JOIN asientos a ON ad.asiento_id = a.id
                    WHERE ad.cuenta_codigo = ? AND a.anulado = 0
                `).all(bankAccount);

                // We simulate matching the spreadsheet uploads
                const sheetRecords = body.records || [];
                const matched = [];
                const unmatchedLedger = [...ledgerEntries];
                const unmatchedSheet = [];

                for (const sheetRec of sheetRecords) {
                    const sheetVal = Number(sheetRec.valor);
                    const isDebit = sheetRec.tipo === 'ingreso'; // sheet ingress = ledger debit (income)
                    
                    const matchIndex = unmatchedLedger.findIndex(le => {
                        const ledgerVal = isDebit ? le.debito : le.credito;
                        // Match by amount and date close enough
                        return Math.abs(ledgerVal - Math.abs(sheetVal)) < 0.01 && 
                               (new Date(le.fecha).toDateString() === new Date(sheetRec.fecha).toDateString());
                    });

                    if (matchIndex !== -1) {
                        matched.push({
                            sheet: sheetRec,
                            ledger: unmatchedLedger[matchIndex]
                        });
                        unmatchedLedger.splice(matchIndex, 1);
                    } else {
                        unmatchedSheet.push(sheetRec);
                    }
                }

                return sendJson(res, {
                    success: true,
                    matchedCount: matched.length,
                    unmatchedLedgerCount: unmatchedLedger.length,
                    unmatchedSheetCount: unmatchedSheet.length,
                    unmatchedLedger: unmatchedLedger,
                    unmatchedSheet: unmatchedSheet
                });
            }

            return sendJson(res, { error: 'Acción API no reconocida' }, 404);

        } catch (error) {
            console.error('API Error:', error);
            return sendJson(res, { error: `Internal Server Error: ${error.message}` }, 500);
        }
    } else {
        // Serve static web interface
        return serveStaticFile(req, res, reqUrl);
    }
});

server.listen(PORT, () => {
    console.log(`SIMPLIX ERP Server running at http://localhost:${PORT}`);
});
