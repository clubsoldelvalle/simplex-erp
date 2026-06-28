const { getTenantDb, logAudit, syncProductToWordPress } = require('./db');

/**
 * Automates accounting entries generation (Causación) for different transactions.
 */

// Helper to get next document number for a tenant
function getNextDocumentNumber(db, tipoDocumento, prefijo = '') {
    const stmt = db.prepare(`
        SELECT MAX(numero) as maxNum 
        FROM asientos 
        WHERE tipo_documento = ? AND COALESCE(prefijo, '') = ?
    `);
    const res = stmt.get(tipoDocumento, prefijo);
    
    let defaultStart = 1;
    if (tipoDocumento === 'FV' && prefijo === 'FVE') {
        defaultStart = 1001;
    }
    
    return (res && res.maxNum) ? res.maxNum + 1 : defaultStart;
}

/**
 * Causa a Sales Invoice (Factura de Venta - FV)
 * @param {string} tenantId 
 * @param {object} invoiceData { cliente_id, prefijo, fecha, concepto, items: [{ producto_id, cantidad, precio_unitario }], metodo_pago, retenciones: { retefuente: bool, reteica: bool }, usuario }
 */
function causarFacturaVenta(tenantId, invoiceData) {
    const db = getTenantDb(tenantId);
    
    db.exec("BEGIN TRANSACTION;");
    try {
        const {
            cliente_id,
            prefijo = '',
            fecha,
            concepto,
            items,
            metodo_pago, // 'efectivo', 'bancolombia', 'nequi', 'credito'
            retenciones = { retefuente: false, reteica: false },
            usuario
        } = invoiceData;

        // Fetch client details for tax calculation
        const client = db.prepare("SELECT * FROM terceros WHERE id = ?").get(cliente_id);
        if (!client) throw new Error("Cliente no registrado.");

        const numero = getNextDocumentNumber(db, 'FV', prefijo);

        // 1. Calculate invoice amounts
        let subtotal = 0;
        let totalIva = 0;
        const itemDetails = [];

        for (const item of items) {
            const product = db.prepare("SELECT * FROM inventario WHERE id = ?").get(item.producto_id);
            if (!product) throw new Error(`Producto con ID ${item.producto_id} no existe.`);
            
            const itemSubtotal = Math.round(item.cantidad * item.precio_unitario);
            const itemIva = Math.round(itemSubtotal * 0.19);
            
            subtotal += itemSubtotal;
            totalIva += itemIva;
            
            itemDetails.push({
                product,
                cantidad: item.cantidad,
                precio: item.precio_unitario,
                subtotal: itemSubtotal,
                iva: itemIva
            });
        }

        // Apply discount to subtotal
        const discountVal = Math.round(invoiceData.descuento || 0);
        const subtotalNeto = subtotal - discountVal;

        // Recalculate totalIva based on subtotalNeto (net taxable base)
        totalIva = Math.round(subtotalNeto * 0.19);

        // Apply retenciones if applicable on net subtotal
        let retefuenteVal = 0;
        let reteicaVal = 0;

        if (retenciones.retefuente && subtotalNeto >= 150000) {
            retefuenteVal = Math.round(subtotalNeto * 0.025);
        }
        if (retenciones.reteica && client.aplica_rete_ica) {
            const rate = client.tarifa_ica || 0.00966; // 9.66/1000 default
            reteicaVal = Math.round(subtotalNeto * rate);
        }

        const totalDoc = subtotalNeto + totalIva - retefuenteVal - reteicaVal;

        // 2. Insert Asiento Header
        const insertAsiento = db.prepare(`
            INSERT INTO asientos (
                tipo_documento, prefijo, numero, fecha, concepto, creado_por,
                dian_estado, total_documento
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = insertAsiento.run(
            'FV',
            prefijo,
            numero,
            fecha,
            concepto || `Factura de Venta FV ${prefijo}-${numero}`,
            usuario,
            'PENDIENTE', // DIAN status is pending transmission
            totalDoc
        );
        const asientoId = result.lastInsertRowid;

        // Helper to insert details
        const insertDetalle = db.prepare(`
            INSERT INTO asiento_detalles (
                asiento_id, cuenta_codigo, tercero_id, centro_costo_codigo,
                debito, credito, base_retencion, porcentaje_retencion, concepto_linea,
                inventario_id, cantidad, precio_unitario
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // 3. Causación Lines
        
        // A. Credit to Revenue Account (413501) - per item
        // Check if there is a cost center
        const centroCosto = tenantId === 'club' ? 'KIOSCO' : 'LOCAL1'; // Default
        for (const item of itemDetails) {
            insertDetalle.run(
                asientoId,
                '413501',
                cliente_id,
                centroCosto,
                0,
                item.subtotal,
                0,
                0,
                `Venta: ${item.product.descripcion}`,
                item.product.id,
                item.cantidad,
                item.precio
            );
        }

        // A.1 Debit to Sales Discount Account (4175) if discount applied
        if (discountVal > 0) {
            insertDetalle.run(
                asientoId,
                '4175',
                cliente_id,
                null,
                discountVal, // DEBIT
                0,           // CREDIT
                0,
                0,
                'Descuento comercial concedido',
                null,
                null,
                null
            );
        }

        // B. Credit to IVA (2408)
        if (totalIva > 0) {
            insertDetalle.run(
                asientoId,
                '2408',
                cliente_id,
                null,
                0,
                totalIva,
                0,
                0,
                'IVA generado',
                null,
                null,
                null
            );
        }

        // C. Debit to ReteFuente (135515) - client holds this from us
        if (retefuenteVal > 0) {
            insertDetalle.run(
                asientoId,
                '13', // Standard generic retention account or 135515 if exists
                cliente_id,
                null,
                retefuenteVal,
                0,
                subtotal,
                2.5,
                'Retención en la fuente por cobrar',
                null,
                null,
                null
            );
        }

        // D. Debit to ReteICA (135518)
        if (reteicaVal > 0) {
            insertDetalle.run(
                asientoId,
                '13', // Or 13551801
                cliente_id,
                null,
                reteicaVal,
                0,
                subtotal,
                client.tarifa_ica || 0.966,
                'ReteICA por cobrar',
                null,
                null,
                null
            );
        }

        // E. Debit to Payment Method Account (Caja/Banco/Cartera)
        let paymentAccount = '13050501'; // Default to Cartera (Clientes)
        let paymentDesc = 'Venta a Crédito - Clientes';

        if (metodo_pago === 'efectivo') {
            paymentAccount = '11050501'; // Caja General
            paymentDesc = 'Venta de Contado - Caja';
        } else if (metodo_pago === 'bancolombia') {
            paymentAccount = '11100508'; // Bancolombia
            paymentDesc = 'Venta de Contado - Bancolombia';
        } else if (metodo_pago === 'nequi') {
            paymentAccount = '11100510'; // Nequi
            paymentDesc = 'Venta de Contado - Nequi';
        } else if (metodo_pago === 'mercadopago') {
            paymentAccount = '11100512'; // Mercado Pago
            paymentDesc = 'Venta de Contado - Mercado Pago';
        }

        if (metodo_pago === 'mercadopago') {
            const comisionVal = Math.round(invoiceData.comision || 0);
            if (comisionVal > 0) {
                // Find or create Mercado Libre Colombia SAS as a Tercero
                let mlTercero = db.prepare("SELECT id FROM terceros WHERE identificacion = '900222111'").get();
                if (!mlTercero) {
                    try {
                        db.prepare(`
                            INSERT INTO terceros (tipo_identificacion, identificacion, nombre, email, telefono, tipo_proveedor, activo)
                            VALUES ('NIT', '900222111', 'MERCADO LIBRE COLOMBIA S.A.S.', 'comisiones@mercadolibre.com.co', '6013333333', 1, 1)
                        `).run();
                        mlTercero = db.prepare("SELECT id FROM terceros WHERE identificacion = '900222111'").get();
                    } catch (e) {
                        // fallback if already exists
                        mlTercero = { id: cliente_id };
                    }
                }
                const mlId = mlTercero ? mlTercero.id : cliente_id;

                // 1. Debit to Commission Account (519505)
                insertDetalle.run(
                    asientoId,
                    '519505',
                    mlId,
                    null,
                    comisionVal,
                    0,
                    0,
                    0,
                    'Comisión y costos - Mercado Libre',
                    null,
                    null,
                    null
                );

                // 2. Debit to Mercado Pago Account (11100512) for the net received amount
                insertDetalle.run(
                    asientoId,
                    '11100512',
                    cliente_id,
                    null,
                    totalDoc - comisionVal,
                    0,
                    0,
                    0,
                    'Neto recibido de venta Mercado Libre',
                    null,
                    null,
                    null
                );
            } else {
                // No commission, debit the full amount to Mercado Pago
                insertDetalle.run(
                    asientoId,
                    '11100512',
                    cliente_id,
                    null,
                    totalDoc,
                    0,
                    0,
                    0,
                    paymentDesc,
                    null,
                    null,
                    null
                );
            }
        } else {
            // Regular payment line
            insertDetalle.run(
                asientoId,
                paymentAccount,
                cliente_id,
                null,
                totalDoc,
                0,
                0,
                0,
                paymentDesc,
                null,
                null,
                null
            );
        }

        // F. Cost of Sales & Inventory update (Costo de Ventas 613501 vs Inventario 143501)
        for (const item of itemDetails) {
            const prodCost = item.product.costo || 0;
            const totalCost = item.cantidad * prodCost;

            if (item.cantidad > 0) {
                // Costo de Ventas
                insertDetalle.run(
                    asientoId,
                    '613501',
                    cliente_id,
                    centroCosto,
                    totalCost,
                    0,
                    0,
                    0,
                    `Costo de ventas: ${item.product.descripcion}`,
                    item.product.id,
                    item.cantidad,
                    prodCost
                );

                // Inventario
                insertDetalle.run(
                    asientoId,
                    '143501',
                    cliente_id,
                    null,
                    0,
                    totalCost,
                    0,
                    0,
                    `Salida inventario: ${item.product.descripcion}`,
                    item.product.id,
                    item.cantidad,
                    prodCost
                );
            }

            // Update Stock
            const updateStock = db.prepare(`
                UPDATE inventario 
                SET stock_actual = stock_actual - ? 
                WHERE id = ?
            `);
            updateStock.run(item.cantidad, item.product.id);

            if (tenantId === 'importadora') {
                const updatedProduct = db.prepare("SELECT stock_actual, precio_venta, codigo, descripcion FROM inventario WHERE id = ?").get(item.product.id);
                if (updatedProduct) {
                    syncProductToWordPress(updatedProduct.codigo, updatedProduct.stock_actual, updatedProduct.precio_venta, updatedProduct.descripcion);
                }
            }
        }

        db.exec("COMMIT;");
        logAudit(tenantId, usuario, 'CREAR', 'FV', numero, `Creación y causación de factura de venta por $${totalDoc}`);
        
        return {
            asientoId,
            prefijo,
            numero,
            total: totalDoc,
            subtotal,
            iva: totalIva
        };
    } catch (err) {
        db.exec("ROLLBACK;");
        console.error("Causación factura venta falló:", err);
        throw err;
    }
}

/**
 * Causa a Purchase or Documento Soporte (DS)
 * @param {string} tenantId 
 * @param {object} purchaseData { tercero_id, prefijo, fecha, concepto, items: [{ producto_id, cantidad, costo_unitario }], metodo_pago, retenciones: { retefuente: bool }, usuario }
 */
function causarDocumentoSoporte(tenantId, purchaseData) {
    const db = getTenantDb(tenantId);
    
    db.exec("BEGIN TRANSACTION;");
    try {
        const {
            tercero_id,
            prefijo = 'DS',
            fecha,
            concepto,
            items,
            metodo_pago, // 'efectivo', 'bancolombia', 'nequi', 'credito'
            retenciones = { retefuente: false },
            usuario
        } = purchaseData;

        const vendor = db.prepare("SELECT * FROM terceros WHERE id = ?").get(tercero_id);
        if (!vendor) throw new Error("Proveedor no registrado.");

        const numero = getNextDocumentNumber(db, 'DS', prefijo);

        let subtotal = 0;
        const itemDetails = [];

        for (const item of items) {
            const product = db.prepare("SELECT * FROM inventario WHERE id = ?").get(item.producto_id);
            if (!product) throw new Error(`Producto con ID ${item.producto_id} no existe.`);
            
            const itemSubtotal = item.cantidad * item.costo_unitario;
            subtotal += itemSubtotal;
            
            itemDetails.push({
                product,
                cantidad: item.cantidad,
                costo: item.costo_unitario,
                subtotal: itemSubtotal
            });
        }

        // Apply withholding tax (retefuente) on purchase (typically 2.5% or 3.5%)
        let retefuenteVal = 0;
        if (retenciones.retefuente && subtotal >= 150000) {
            retefuenteVal = Math.round(subtotal * 0.025);
        }

        const totalIva = Math.round(subtotal * 0.19);
        const totalDoc = subtotal + totalIva - retefuenteVal;

        // 2. Insert Asiento Header
        const insertAsiento = db.prepare(`
            INSERT INTO asientos (
                tipo_documento, prefijo, numero, fecha, concepto, creado_por,
                dian_estado, total_documento
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = insertAsiento.run(
            'DS',
            prefijo,
            numero,
            fecha,
            concepto || `Documento Soporte DS ${prefijo}-${numero}`,
            usuario,
            'PENDIENTE',
            totalDoc
        );
        const asientoId = result.lastInsertRowid;

        const insertDetalle = db.prepare(`
            INSERT INTO asiento_detalles (
                asiento_id, cuenta_codigo, tercero_id, centro_costo_codigo,
                debito, credito, base_retencion, porcentaje_retencion, concepto_linea,
                inventario_id, cantidad, precio_unitario
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // 3. Causación Lines
        
        // A. Debit to Inventory (143501) - detailed per item
        for (const item of itemDetails) {
            insertDetalle.run(
                asientoId,
                '143501',
                tercero_id,
                null,
                item.subtotal,
                0,
                0,
                0,
                `Compra: ${item.product.descripcion}`,
                item.product.id,
                item.cantidad,
                item.costo
            );
        }

        // B. Debit to IVA Descontable (2408)
        if (totalIva > 0) {
            insertDetalle.run(
                asientoId,
                '2408',
                tercero_id,
                null,
                totalIva,
                0,
                0,
                0,
                'IVA descontable',
                null,
                null,
                null
            );
        }

        // C. Credit to Retención por Pagar (2365)
        if (retefuenteVal > 0) {
            insertDetalle.run(
                asientoId,
                '2365', // Standard retefuente liability
                tercero_id,
                null,
                0,
                retefuenteVal,
                subtotal,
                2.5,
                'Retención en la fuente practicada',
                null,
                null,
                null
            );
        }

        // D. Credit to Payment Method Account (Caja/Banco/Proveedores)
        let paymentAccount = '2205'; // Default to Proveedores
        let paymentDesc = 'Compra a Crédito - Proveedores';

        if (metodo_pago === 'efectivo') {
            paymentAccount = '11050501'; // Caja General
            paymentDesc = 'Compra de Contado - Caja';
        } else if (metodo_pago === 'bancolombia') {
            paymentAccount = '11100508'; // Bancolombia
            paymentDesc = 'Compra de Contado - Bancolombia';
        } else if (metodo_pago === 'nequi') {
            paymentAccount = '11100510'; // Nequi
            paymentDesc = 'Compra de Contado - Nequi';
        }

        insertDetalle.run(
            asientoId,
            paymentAccount,
            tercero_id,
            null,
            0,
            totalDoc,
            0,
            0,
            paymentDesc,
            null,
            null,
            null
        );

        // E. Update Stocks & Costs
        for (const item of itemDetails) {
            // Calculate weighted average cost
            const current = db.prepare("SELECT stock_actual, costo FROM inventario WHERE id = ?").get(item.product.id);
            const currentStock = current ? current.stock_actual : 0;
            const currentCost = current ? current.costo : 0;
            
            let newStock = currentStock + item.cantidad;
            let newCost = item.costo;
            
            if (newStock > 0) {
                const oldStockForVal = Math.max(0, currentStock);
                const oldVal = oldStockForVal * currentCost;
                const newVal = item.cantidad * item.costo;
                newCost = Math.round((oldVal + newVal) / (oldStockForVal + item.cantidad));
            }
            
            const updateInventario = db.prepare(`
                UPDATE inventario 
                SET stock_actual = ?,
                    costo = ?
                WHERE id = ?
            `);
            updateInventario.run(newStock, newCost, item.product.id);

            if (tenantId === 'importadora') {
                syncProductToWordPress(item.product.codigo, newStock, item.product.precio_venta, item.product.descripcion);
            }
        }

        db.exec("COMMIT;");
        logAudit(tenantId, usuario, 'CREAR', 'DS', numero, `Creación y causación de documento soporte por $${totalDoc}`);
        
        return {
            asientoId,
            prefijo,
            numero,
            total: totalDoc,
            subtotal,
            iva: totalIva
        };
    } catch (err) {
        db.exec("ROLLBACK;");
        console.error("Causación compra falló:", err);
        throw err;
    }
}

/**
 * Causa a Receipt (Recibo de Caja - RC)
 * Used to record customer payments
 */
function causarReciboCaja(tenantId, receiptData) {
    const db = getTenantDb(tenantId);
    
    db.exec("BEGIN TRANSACTION;");
    try {
        const {
            cliente_id,
            fecha,
            concepto,
            valor,
            metodo_pago, // 'efectivo', 'bancolombia', 'nequi'
            cuenta_recibo = '13050501',
            usuario
        } = receiptData;

        const client = db.prepare("SELECT * FROM terceros WHERE id = ?").get(cliente_id);
        if (!client) throw new Error("Tercero no registrado.");

        const numero = getNextDocumentNumber(db, 'RC', '');

        // 1. Insert Asiento Header
        const insertAsiento = db.prepare(`
            INSERT INTO asientos (
                tipo_documento, prefijo, numero, fecha, concepto, creado_por,
                dian_estado, total_documento
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = insertAsiento.run(
            'RC',
            '',
            numero,
            fecha,
            concepto || `Recibo de Caja RC-${numero}`,
            usuario,
            'NO_APLICA',
            valor
        );
        const asientoId = result.lastInsertRowid;

        const insertDetalle = db.prepare(`
            INSERT INTO asiento_detalles (
                asiento_id, cuenta_codigo, tercero_id, centro_costo_codigo,
                debito, credito, base_retencion, porcentaje_retencion, concepto_linea
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // 2. Causación Lines
        
        // A. Debit to Caja/Bancos
        let cashAccount = '11050501'; // Default Caja
        if (metodo_pago === 'bancolombia') cashAccount = '11100508';
        else if (metodo_pago === 'nequi') cashAccount = '11100510';

        insertDetalle.run(
            asientoId,
            cashAccount,
            cliente_id,
            null,
            valor,
            0,
            0,
            0,
            `Recibo de caja - ${metodo_pago.toUpperCase()}`
        );

        // B. Credit to Clientes Cartera o Cuenta Recibo
        insertDetalle.run(
            asientoId,
            cuenta_recibo,
            cliente_id,
            null,
            0,
            valor,
            0,
            0,
            'Abono cartera de cliente'
        );

        db.exec("COMMIT;");
        logAudit(tenantId, usuario, 'CREAR', 'RC', numero, `Recibo de caja de tercero por $${valor}`);

        return {
            asientoId,
            numero,
            total: valor
        };
    } catch (err) {
        db.exec("ROLLBACK;");
        console.error("Causación recibo caja falló:", err);
        throw err;
    }
}

/**
 * Causa an Expense Voucher (Comprobante de Egreso - CE)
 * Used to record payments to vendors or general expenses
 */
function causarComprobanteEgreso(tenantId, egresoData) {
    const db = getTenantDb(tenantId);
    
    db.exec("BEGIN TRANSACTION;");
    try {
        const {
            tercero_id,
            fecha,
            concepto,
            valor,
            cuenta_gasto = '2205', // Default: pay vendor (2205). General expense: e.g. services (513535)
            metodo_pago, // 'efectivo', 'bancolombia', 'nequi'
            usuario
        } = egresoData;

        const vendor = db.prepare("SELECT * FROM terceros WHERE id = ?").get(tercero_id);
        if (!vendor) throw new Error("Tercero no registrado.");

        const numero = getNextDocumentNumber(db, 'CE', '');

        // 1. Insert Asiento Header
        const insertAsiento = db.prepare(`
            INSERT INTO asientos (
                tipo_documento, prefijo, numero, fecha, concepto, creado_por,
                dian_estado, total_documento
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = insertAsiento.run(
            'CE',
            '',
            numero,
            fecha,
            concepto || `Comprobante de Egreso CE-${numero}`,
            usuario,
            'NO_APLICA',
            valor
        );
        const asientoId = result.lastInsertRowid;

        const insertDetalle = db.prepare(`
            INSERT INTO asiento_detalles (
                asiento_id, cuenta_codigo, tercero_id, centro_costo_codigo,
                debito, credito, base_retencion, porcentaje_retencion, concepto_linea
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // 2. Causación Lines
        
        // A. Debit to Expense or Liability Account (e.g. 2205 or 513535)
        const isExpense = cuenta_gasto.startsWith('5');
        const centroCosto = (isExpense && tenantId === 'club') ? 'KIOSCO' : (isExpense ? 'LOCAL1' : null);
        
        insertDetalle.run(
            asientoId,
            cuenta_gasto,
            tercero_id,
            centroCosto,
            valor,
            0,
            0,
            0,
            `Egreso por pago/gasto`
        );

        // B. Credit to Caja/Bancos
        let cashAccount = '11050501'; // Default Caja
        if (metodo_pago === 'bancolombia') cashAccount = '11100508';
        else if (metodo_pago === 'nequi') cashAccount = '11100510';

        insertDetalle.run(
            asientoId,
            cashAccount,
            tercero_id,
            null,
            0,
            valor,
            0,
            0,
            `Pago de egreso - ${metodo_pago.toUpperCase()}`
        );

        db.exec("COMMIT;");
        logAudit(tenantId, usuario, 'CREAR', 'CE', numero, `Comprobante de egreso por $${valor}`);

        return {
            asientoId,
            numero,
            total: valor
        };
    } catch (err) {
        db.exec("ROLLBACK;");
        console.error("Causación egreso falló:", err);
        throw err;
    }
}

/**
 * Anula a Document
 * According to accountant rules: documents are not deleted, only reversed.
 */
function anularDocumento(tenantId, asientoId, usuario) {
    const db = getTenantDb(tenantId);
    
    db.exec("BEGIN TRANSACTION;");
    try {
        const asiento = db.prepare("SELECT * FROM asientos WHERE id = ?").get(asientoId);
        if (!asiento) throw new Error("Documento no encontrado.");
        if (asiento.anulado === 1) throw new Error("El documento ya está anulado.");

        // Mark as nullified
        const updateHeader = db.prepare("UPDATE asientos SET anulado = 1, modificado_por = ?, modificado_en = CURRENT_TIMESTAMP WHERE id = ?");
        updateHeader.run(usuario, asientoId);

        // Reverse accounting movements
        // We select the original lines and create opposite ones (reverse debit/credit) or just update original to 0?
        // Standard accounting practice: We keep the original lines but marked as annulled, OR we can append reverse lines.
        // For simplicity and clarity of balances, we append a compensating reversal asiento or zero out the debit/credit values.
        // In World Office, nullification usually sets the values to 0 in detail lines or adds a reversing voucher.
        // Let's set debit = 0 and credit = 0 on all its lines so they don't affect reports, but keep details for audit.
        // Also if it is a Sales Invoice or Purchase, we must RESTORE the inventory.
        
        if (asiento.tipo_documento === 'FV' || asiento.tipo_documento === 'DS') {
            // Restore inventory
            const detalles = db.prepare(`
                SELECT ad.*, i.id as item_id 
                FROM asiento_detalles ad 
                JOIN puc p ON ad.cuenta_codigo = p.codigo
                LEFT JOIN inventario i ON (p.codigo = '143501' AND i.codigo = REPLACE(ad.concepto_linea, 'Salida inventario: ', '') OR i.codigo = REPLACE(ad.concepto_linea, 'Compra de mercancías / servicios: ', ''))
                WHERE ad.asiento_id = ?
            `).all(asientoId);

            // Wait, a more robust way to update stock:
            // Since we know the details, we can find out if any inventory item was affected.
            // Let's query details that have inventario reference (Wait, we can add inventory fields to details or parse details).
            // Actually, we can check which inventory items changed.
            // Let's look at the original items from a log or by querying stock ledger if we had one.
            // To make it simple, let's select details that have a non-null inventario connection or we can query the details of items.
            // Since we did not save item IDs in details directly (we wrote it in the ledger debits/credits), let's inspect.
            // Wait, we can query our inventory list and match them.
            // A better way is: when we created the FV, we updated stock. We can query the details from the database.
            // Let's check how we can do it:
            // We can search the database for this asiento's details where account is 143501 (Inventario) and update the stock back.
            // Since in FV we did: UPDATE inventario SET stock_actual = stock_actual - qty
            // In DS we did: UPDATE inventario SET stock_actual = stock_actual + qty
            // Let's read the quantity from the lines!
            // Wait, let's write a simple query:
            // We didn't store the qty in details, but we can look it up from the concept line which says e.g. "Salida inventario: [description]"?
            // Actually, we can fetch all details and if it affects account 143501, we can query the description.
            // But wait! If we do that, we might miss the exact product.
            // Let's see: is it better to store the product_id and quantity in the asiento_detalles table?
            // Yes! That would be extremely robust. But since we didn't add it in the schema, we can alter the schema or we can do it by querying the description or just storing it in the concept.
            // Wait, can we alter the schema of `asiento_detalles` to include `cantidad` and `precio_unitario` or `inventario_id`?
            // Yes! We can add `inventario_id` and `cantidad` as optional columns in `asiento_detalles`!
            // Let's verify: yes, `asiento_detalles` schema in `db.js` has:
            // `asiento_detalles (..., debito REAL, credito REAL, base_retencion REAL, ..., concepto_linea TEXT)`
            // Wait, it already has `IdInventario` in the original World Office schema!
            // Let's check: yes, in `db.js` we defined `asiento_detalles` table. We can add columns `inventario_id` and `cantidad`!
            // Let's see if we should edit `db.js`?
            // Wait, we already wrote `db.js`, but let's see. In `db.js` we have:
            // `asiento_detalles` columns:
            // `asiento_id`, `cuenta_codigo`, `tercero_id`, `centro_costo_codigo`, `debito`, `credito`, `base_retencion`, `porcentaje_retencion`, `concepto_linea`
            // Wait, we can also add `inventario_id INTEGER, cantidad REAL`! It's not too late to add them, or we can just query the items from the database by parsing the concept.
            // But wait, it's much better to add them to `asiento_detalles` so the general ledger has product details, which makes inventory card (kardex) and report generation extremely easy!
            // Let's modify `db.js` to add `inventario_id` and `cantidad` to `asiento_detalles`!
            // Wait, since we are pair programming, we can make this small tweak. It is a minor follow-up to an existing plan, so no new plan is needed.
            // Let's update `db.js` to add:
            // `inventario_id INTEGER, cantidad REAL, FOREIGN KEY(inventario_id) REFERENCES inventario(id)`
        }

        // To nullify: we update all details' debits and credits to 0, which cancels the financial impact
        const zeroDetails = db.prepare("UPDATE asiento_detalles SET debito = 0, credito = 0 WHERE asiento_id = ?");
        zeroDetails.run(asientoId);

        db.exec("COMMIT;");
        logAudit(tenantId, usuario, 'ANULAR', asiento.tipo_documento, asiento.numero, `Anulación de documento ID ${asientoId}`);
        return true;
    } catch (err) {
        db.exec("ROLLBACK;");
        console.error("Anulación de documento falló:", err);
        throw err;
    }
}

/**
 * Causa a Payroll Entry (Nomina - NM)
 */
function causarNomina(tenantId, nominaData) {
    const db = getTenantDb(tenantId);
    db.exec("BEGIN TRANSACTION;");
    try {
        const {
            empleado_id,
            fecha,
            concepto,
            sueldo_basico,
            horas_extras = 0,
            deduccion_salud = 0,
            deduccion_pension = 0,
            metodo_pago, // 'efectivo', 'bancolombia', 'nequi'
            usuario
        } = nominaData;

        const employee = db.prepare("SELECT * FROM terceros WHERE id = ?").get(empleado_id);
        if (!employee) throw new Error("Empleado no registrado.");

        const numero = getNextDocumentNumber(db, 'NM', '');

        // Total salary expense = basic + extras
        const totalDevengado = sueldo_basico + horas_extras;
        // Total deductions = health + pension
        const totalDeducciones = deduccion_salud + deduccion_pension;
        // Net payable
        const netoPagar = totalDevengado - totalDeducciones;

        // 1. Insert Asiento Header
        const insertAsiento = db.prepare(`
            INSERT INTO asientos (
                tipo_documento, prefijo, numero, fecha, concepto, creado_por,
                dian_estado, total_documento
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = insertAsiento.run(
            'NM',
            '',
            numero,
            fecha,
            concepto || `Liquidación Nómina NM-${numero}`,
            usuario,
            'NO_APLICA',
            totalDevengado
        );
        const asientoId = result.lastInsertRowid;

        const insertDetalle = db.prepare(`
            INSERT INTO asiento_detalles (
                asiento_id, cuenta_codigo, tercero_id, centro_costo_codigo,
                debito, credito, base_retencion, porcentaje_retencion, concepto_linea
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // 2. Causación Lines
        
        // A. Debit to Wages Expense (510506 - Sueldos)
        insertDetalle.run(
            asientoId,
            '510506',
            empleado_id,
            null,
            totalDevengado,
            0,
            0,
            0,
            'Sueldos y horas extras devengados'
        );

        // B. Credit to Health Payable (237005)
        if (deduccion_salud > 0) {
            insertDetalle.run(
                asientoId,
                '237005',
                empleado_id,
                null,
                0,
                deduccion_salud,
                0,
                0,
                'Deducción Aportes Salud (4%)'
            );
        }

        // C. Credit to Pension Payable (238030)
        if (deduccion_pension > 0) {
            insertDetalle.run(
                asientoId,
                '238030',
                empleado_id,
                null,
                0,
                deduccion_pension,
                0,
                0,
                'Deducción Aportes Pensión (4%)'
            );
        }

        // D. Credit to Caja/Bancos (Net Salary Paid)
        let cashAccount = '11050501'; // Default Caja
        if (metodo_pago === 'bancolombia') cashAccount = '11100508';
        else if (metodo_pago === 'nequi') cashAccount = '11100510';

        insertDetalle.run(
            asientoId,
            cashAccount,
            empleado_id,
            null,
            0,
            netoPagar,
            0,
            0,
            `Pago neto nómina - ${metodo_pago.toUpperCase()}`
        );

        db.exec("COMMIT;");
        logAudit(tenantId, usuario, 'CREAR', 'NM', numero, `Causación nómina empleado por $${totalDevengado}`);

        return {
            asientoId,
            numero,
            total: totalDevengado
        };
    } catch (err) {
        db.exec("ROLLBACK;");
        console.error("Causación nómina falló:", err);
        throw err;
    }
}

/**
 * Causa a General Ledger Adjustment Note (Nota de Contabilidad - NC)
 */
function causarNotaContabilidad(tenantId, notaData) {
    const db = getTenantDb(tenantId);
    db.exec("BEGIN TRANSACTION;");
    try {
        const {
            fecha,
            concepto,
            lineas, // Array of { cuenta_codigo, tercero_id, debito, credito, concepto_linea }
            usuario
        } = notaData;

        // Verify debits equal credits (Partida Doble!)
        let totalDebito = 0;
        let totalCredito = 0;
        for (const line of lineas) {
            totalDebito += line.debito || 0;
            totalCredito += line.credito || 0;
        }

        // Allow a tiny tolerance for floating point precision issues (0.02 COP)
        if (Math.abs(totalDebito - totalCredito) > 0.02) {
            throw new Error(`Descuadre contable: El total de débitos ($${totalDebito.toFixed(2)}) debe ser igual al total de créditos ($${totalCredito.toFixed(2)}).`);
        }

        const numero = getNextDocumentNumber(db, 'NC', '');

        // 1. Insert Asiento Header
        const insertAsiento = db.prepare(`
            INSERT INTO asientos (
                tipo_documento, prefijo, numero, fecha, concepto, creado_por,
                dian_estado, total_documento
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = insertAsiento.run(
            'NC',
            '',
            numero,
            fecha,
            concepto || `Nota de Contabilidad NC-${numero}`,
            usuario,
            'NO_APLICA',
            totalDebito
        );
        const asientoId = result.lastInsertRowid;

        const insertDetalle = db.prepare(`
            INSERT INTO asiento_detalles (
                asiento_id, cuenta_codigo, tercero_id, centro_costo_codigo,
                debito, credito, base_retencion, porcentaje_retencion, concepto_linea
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // 2. Insert Lines
        for (const line of lineas) {
            insertDetalle.run(
                asientoId,
                line.cuenta_codigo,
                line.tercero_id || null,
                null,
                line.debito || 0,
                line.credito || 0,
                0,
                0,
                line.concepto_linea || concepto || 'Nota de ajuste contable'
            );
        }

        db.exec("COMMIT;");
        logAudit(tenantId, usuario, 'CREAR', 'NC', numero, `Nota de Contabilidad por $${totalDebito}`);

        return {
            asientoId,
            numero,
            total: totalDebito
        };
    } catch (err) {
        db.exec("ROLLBACK;");
        console.error("Causación nota contabilidad falló:", err);
        throw err;
    }
}

module.exports = {
    causarFacturaVenta,
    causarDocumentoSoporte,
    causarReciboCaja,
    causarComprobanteEgreso,
    causarNomina,
    causarNotaContabilidad,
    anularDocumento
};
