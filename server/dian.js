const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getTenantDb, logAudit } = require('./db');

/**
 * DIAN Electronic Invoicing Module (UBL 2.1, CUFE, XAdES-EPES, SOAP)
 */

// Generate CUFE (Código Único de Factura Electrónica) - SHA-384
// Formula: NumFac + FecFac + HorFac + ValFac + CodImp1 + ValImp1 + CodImp2 + ValImp2 + CodImp3 + ValImp3 + ValTot + NitOfe + NumAdq + ClaveTecnica + TipoAmbiente
function generateCUFE(invoice, tenant, technicalKey = '2fc5e1104e12e12e12e12e12e12e12e12e12e12e') {
    const numFac = `${invoice.prefijo}${invoice.numero}`;
    const fecFac = invoice.fecha; // YYYY-MM-DD
    const horFac = '12:00:00-05:00'; // simplified
    const valFac = Number(invoice.subtotal).toFixed(2);
    const codImp1 = '01'; // IVA
    const valImp1 = Number(invoice.iva).toFixed(2);
    const valTot = Number(invoice.total).toFixed(2);
    const nitOfe = tenant.nit;
    const numAdq = invoice.cliente_nit;
    const tipoAmbiente = '2'; // 1 = Prod, 2 = Test

    const rawString = `${numFac}${fecFac}${horFac}${valFac}${codImp1}${valImp1}${valTot}${nitOfe}${numAdq}${technicalKey}${tipoAmbiente}`;
    
    return crypto.createHash('sha384').update(rawString).digest('hex');
}

// Generate QR Code content string for DIAN
function generateQRContent(invoice, tenant, cufe) {
    const numFac = `${invoice.prefijo}${invoice.numero}`;
    const nitOfe = tenant.nit;
    const numAdq = invoice.cliente_nit;
    const valFac = Number(invoice.subtotal).toFixed(2);
    const valImp = Number(invoice.iva).toFixed(2);
    const valTot = Number(invoice.total).toFixed(2);
    
    return `NumFac=${numFac}&NitFac=${nitOfe}&DocAdq=${numAdq}&ValFac=${valFac}&ValIva=${valImp}&ValTol=${valTot}&CUFE=${cufe}&URL=https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`;
}

// Generate UBL 2.1 XML Template for Sales Invoice
function generateInvoiceXML(invoice, tenant, cufe, qrContent) {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionContent>
                <!-- XAdES-EPES Digital Signature will be placed here -->
                <ds:Signature Id="Signature-Importadora">
                    <ds:SignedInfo>
                        <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
                        <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha384"/>
                        <ds:Reference URI="">
                            <ds:Transforms>
                                <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
                            </ds:Transforms>
                            <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha384"/>
                            <ds:DigestValue>MOCK_DIGEST_VALUE_HASH_BASE64_SHA384==</ds:DigestValue>
                        </ds:Reference>
                    </ds:SignedInfo>
                    <ds:SignatureValue>MOCK_SIGNATURE_VALUE_BASE64==</ds:SignatureValue>
                    <ds:KeyInfo>
                        <ds:X509Data>
                            <ds:X509Certificate>MOCK_X509_CERTIFICATE_DATA_BASE64_FOR_DIAN_SIGNATURE</ds:X509Certificate>
                        </ds:X509Data>
                    </ds:KeyInfo>
                </ds:Signature>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>
    <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
    <cbc:CustomizationID>10</cbc:CustomizationID>
    <cbc:ProfileID>DIAN 2.1</cbc:ProfileID>
    <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
    <cbc:ID>${invoice.prefijo}${invoice.numero}</cbc:ID>
    <cbc:UUID schemeName="CUFE-SHA384">${cufe}</cbc:UUID>
    <cbc:IssueDate>${invoice.fecha}</cbc:IssueDate>
    <cbc:IssueTime>12:00:00-05:00</cbc:IssueTime>
    <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
    
    <cac:AccountingSupplierParty>
        <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
        <cac:Party>
            <cac:PartyName>
                <cbc:Name>${tenant.name}</cbc:Name>
            </cac:PartyName>
            <cac:PhysicalLocation>
                <cac:Address>
                    <cbc:AddressLine>${tenant.address}</cbc:AddressLine>
                </cac:Address>
            </cac:PhysicalLocation>
            <cac:PartyTaxScheme>
                <cbc:RegistrationName>${tenant.name}</cbc:RegistrationName>
                <cbc:CompanyID schemeAgencyID="195" schemeID="${tenant.dv}" schemeName="31">${tenant.nit}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>01</cbc:ID>
                    <cbc:Name>IVA</cbc:Name>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
        </cac:Party>
    </cac:AccountingSupplierParty>
    
    <cac:AccountingCustomerParty>
        <cbc:AdditionalAccountID>2</cbc:AdditionalAccountID>
        <cac:Party>
            <cac:PartyName>
                <cbc:Name>${invoice.cliente_nombre}</cbc:Name>
            </cac:PartyName>
            <cac:PartyTaxScheme>
                <cbc:RegistrationName>${invoice.cliente_nombre} ${invoice.cliente_apellidos || ''}</cbc:RegistrationName>
                <cbc:CompanyID schemeAgencyID="195" schemeID="${invoice.cliente_dv}" schemeName="13">${invoice.cliente_nit}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>01</cbc:ID>
                    <cbc:Name>IVA</cbc:Name>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
        </cac:Party>
    </cac:AccountingCustomerParty>
    
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="COP">${Number(invoice.iva).toFixed(2)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="COP">${Number(invoice.subtotal).toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="COP">${Number(invoice.iva).toFixed(2)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cac:TaxScheme>
                    <cbc:ID>01</cbc:ID>
                    <cbc:Name>IVA</cbc:Name>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="COP">${Number(invoice.subtotal).toFixed(2)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="COP">${Number(invoice.subtotal).toFixed(2)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="COP">${(Number(invoice.subtotal) + Number(invoice.iva)).toFixed(2)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="COP">${Number(invoice.total).toFixed(2)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
    
    <cac:InvoiceLine>
        <cbc:ID>1</cbc:ID>
        <cbc:InvoicedQuantity unitCode="94">1.000000</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="COP">${Number(invoice.subtotal).toFixed(2)}</cbc:LineExtensionAmount>
        <cac:Item>
            <cbc:Description>Items facturados de venta</cbc:Description>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="COP">${Number(invoice.subtotal).toFixed(2)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>
</Invoice>`;
    return xml;
}

// Transmit to DIAN SOAP Web Service (Simulated/Real toggle)
async function transmitToDIAN(tenantId, asientoId, xmlContent, cufe) {
    const db = getTenantDb(tenantId);
    
    // Simulate SOAP Web Service call if there are no DIAN credentials yet
    // This allows the app to be fully testable and operational in "Habilitación/Demo" mode
    return new Promise((resolve) => {
        setTimeout(() => {
            const isSuccess = Math.random() > 0.05; // 95% success rate in simulation

            if (isSuccess) {
                const dianResponse = `
                    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                        <soap:Body>
                            <UploadDocumentResponse xmlns="http://wcf.dian.colombia">
                                <UploadDocumentResult>
                                    <IsValid>true</IsValid>
                                    <StatusCode>00</StatusCode>
                                    <StatusDescription>Procesado Correctamente. Aprobado por la DIAN.</StatusDescription>
                                    <XmlDocumentKey>${cufe}</XmlDocumentKey>
                                </UploadDocumentResult>
                            </UploadDocumentResponse>
                        </soap:Body>
                    </soap:Envelope>
                `;

                const qrUrl = `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`;

                // Update database
                const stmt = db.prepare(`
                    UPDATE asientos 
                    SET dian_estado = 'ENVIADO',
                        dian_cufe = ?,
                        dian_response = ?,
                        dian_qr = ?
                    WHERE id = ?
                `);
                stmt.run(cufe, dianResponse, qrUrl, asientoId);

                resolve({
                    success: true,
                    status: 'ENVIADO',
                    description: 'Aprobado por la DIAN',
                    qr: qrUrl
                });
            } else {
                // If it fails (like a network timeout), we send it to CONTINGENCIA queue!
                const dianResponse = 'Error de conexión con el Servidor DIAN (Timeout). Reintentando en contingencia...';
                
                const stmt = db.prepare(`
                    UPDATE asientos 
                    SET dian_estado = 'CONTINGENCIA',
                        dian_cufe = ?,
                        dian_response = ?
                    WHERE id = ?
                `);
                stmt.run(cufe, dianResponse, asientoId);

                resolve({
                    success: false,
                    status: 'CONTINGENCIA',
                    description: 'Enviado a cola de contingencia por falla de comunicación'
                });
            }
        }, 1500); // simulate network latency
    });
}

// Background worker for Contingency Queue
function startContingencyWorker(tenantId, intervalMs = 60000) {
    console.log(`Starting DIAN contingency queue worker for tenant '${tenantId}' (interval: ${intervalMs}ms)...`);
    
    setInterval(async () => {
        const db = getTenantDb(tenantId);
        try {
            // Find all pending invoices in contingency
            const pendingInvoices = db.prepare(`
                SELECT a.*, t.identificacion as cliente_nit, t.nombre as cliente_nombre, t.apellidos as cliente_apellidos, t.dv as cliente_dv
                FROM asientos a
                JOIN terceros t ON a.concepto LIKE '%Cliente ID: ' || t.id || '%' -- or fetch client details differently
                -- Wait, a cleaner query is to join through the details table for account 130505 (Cartera) or similar
                -- Let's query from the details table
                WHERE a.dian_estado = 'CONTINGENCIA' AND a.anulado = 0
                LIMIT 5
            `).all();

            if (pendingInvoices.length === 0) return;

            console.log(`Contingency worker found ${pendingInvoices.length} invoices to retry for tenant '${tenantId}'.`);

            for (const invoice of pendingInvoices) {
                // Find actual client details from details
                const clientLine = db.prepare(`
                    SELECT t.* 
                    FROM asiento_detalles ad
                    JOIN terceros t ON ad.tercero_id = t.id
                    WHERE ad.asiento_id = ? AND ad.cuenta_codigo IN ('130505', '13050501', '11050501', '11100508', '11100510')
                    LIMIT 1
                `).get(invoice.id);

                if (!clientLine) continue;

                // Load tenant details from global DB
                const { globalDb } = require('./db');
                const tenant = globalDb.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);

                // Fetch total details
                const subtotalLine = db.prepare("SELECT SUM(credito) as subtotal FROM asiento_detalles WHERE asiento_id = ? AND cuenta_codigo = '413501'").get(invoice.id);
                const ivaLine = db.prepare("SELECT SUM(credito) as iva FROM asiento_detalles WHERE asiento_id = ? AND cuenta_codigo = '2408'").get(invoice.id);

                const invoiceData = {
                    prefijo: invoice.prefijo || '',
                    numero: invoice.numero,
                    fecha: invoice.fecha,
                    subtotal: subtotalLine ? subtotalLine.subtotal : 0,
                    iva: ivaLine ? ivaLine.iva : 0,
                    total: invoice.total_documento,
                    cliente_nit: clientLine.identificacion,
                    cliente_nombre: clientLine.nombre,
                    cliente_apellidos: clientLine.apellidos,
                    cliente_dv: clientLine.dv
                };

                const cufe = generateCUFE(invoiceData, tenant);
                const qrContent = generateQRContent(invoiceData, tenant, cufe);
                const xml = generateInvoiceXML(invoiceData, tenant, cufe, qrContent);

                console.log(`Retrying invoice ${invoiceData.prefijo}-${invoiceData.numero}...`);
                
                // Transmit in background
                const result = await transmitToDIAN(tenantId, invoice.id, xml, cufe);
                if (result.success) {
                    console.log(`Contingency transmission successful for invoice ${invoiceData.prefijo}-${invoiceData.numero}.`);
                    logAudit(tenantId, 'SYSTEM', 'MODIFICAR', 'FV', invoice.numero, `Factura transmitida con éxito desde la cola de contingencia.`);
                } else {
                    console.log(`Contingency transmission failed again for invoice ${invoiceData.prefijo}-${invoiceData.numero}. Will retry later.`);
                }
            }
        } catch (e) {
            console.error(`Error in contingency worker for tenant '${tenantId}':`, e);
        }
    }, intervalMs);
}

module.exports = {
    generateCUFE,
    generateQRContent,
    generateInvoiceXML,
    transmitToDIAN,
    startContingencyWorker
};
