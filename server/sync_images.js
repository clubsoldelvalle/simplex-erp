const { DatabaseSync } = require('node:sqlite');
const https = require('node:https');
const path = require('path');

const DB_PATHS = {
    importadora: path.join(__dirname, '..', 'data', 'tenant_importadora.db'),
    club: path.join(__dirname, '..', 'data', 'tenant_club.db')
};

// Helper to make HTTPS requests
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

// Search Mercado Libre API for images
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
    } catch (e) {
        // Silently fail to let fallback handle it
    }
    return null;
}

// Search Bing Images (Web Search fallback)
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
    } catch (e) {
        // Silently fail
    }
    return null;
}

// Fallback images based on keywords
function getFallbackImageUrl(description, tenantId) {
    const desc = description.toLowerCase();
    
    // Autoparts (Importadora)
    if (desc.includes('filtro') || desc.includes('spark') || desc.includes('pastilla') || desc.includes('freno') || desc.includes('bateria') || desc.includes('bosch') || desc.includes('embrague') || desc.includes('sail') || desc.includes('repuesto') || desc.includes('kit')) {
        return 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=200&auto=format&fit=crop&q=60';
    }
    // Sodas and Drinks
    if (desc.includes('coca') || desc.includes('quatro') || desc.includes('jugo') || desc.includes('hit') || desc.includes('soda') || desc.includes('bret') || desc.includes('speed') || desc.includes('agua') || desc.includes('saviloe') || desc.includes('leche') || desc.includes('chocolatada')) {
        return 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=200&auto=format&fit=crop&q=60';
    }
    // Snacks and Foods
    if (desc.includes('golpe') || desc.includes('gomas') || desc.includes('trululu') || desc.includes('mani') || desc.includes('moto') || desc.includes('margarita') || desc.includes('papa') || desc.includes('rizada') || desc.includes('popetas') || desc.includes('takis') || desc.includes('ponky') || desc.includes('ponque') || desc.includes('gala') || desc.includes('helado') || desc.includes('paleta')) {
        return 'https://images.unsplash.com/photo-1599490659213-e2b9527b0876?w=200&auto=format&fit=crop&q=60';
    }
    // Recreation (Club)
    if (desc.includes('piscina') || desc.includes('cancha') || desc.includes('futbol') || desc.includes('entrada') || desc.includes('alquiler') || desc.includes('reserva')) {
        return 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=200&auto=format&fit=crop&q=60';
    }
    
    // Generic
    if (tenantId === 'club') {
        return 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=200&auto=format&fit=crop&q=60'; // Club sports image
    }
    return 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=200&auto=format&fit=crop&q=60'; // Autopart image default for importadora
}

async function syncTenantImages(tenantId) {
    const dbPath = DB_PATHS[tenantId];
    console.log(`\n=== SYNCING IMAGES FOR TENANT: ${tenantId.toUpperCase()} ===`);
    const db = new DatabaseSync(dbPath);
    
    // Ensure the column exists
    try {
        db.exec("ALTER TABLE inventario ADD COLUMN imagen_url TEXT;");
    } catch (e) {}
    
    // Select active products that do not have an image yet (limit to 1000 per run to prevent memory leaks in experimental sqlite)
    const products = db.prepare("SELECT id, codigo, descripcion FROM inventario WHERE activo = 1 AND (imagen_url IS NULL OR imagen_url = '') LIMIT 1000").all();
    console.log(`Found ${products.length} products needing image synchronization.`);
    
    if (products.length === 0) {
        console.log("All active products already have images.");
        return;
    }
    
    const BATCH_SIZE = 12;
    const updateStmt = db.prepare("UPDATE inventario SET imagen_url = ? WHERE id = ?");
    
    let processedCount = 0;
    let mlCount = 0;
    let webCount = 0;
    let fallbackCount = 0;
    
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(products.length / BATCH_SIZE)} (Products ${i + 1} to ${Math.min(i + BATCH_SIZE, products.length)})...`);
        
        const promises = batch.map(async (prod) => {
            const query = prod.descripcion;
            
            // Step 1: Search Mercado Libre
            let imgUrl = await searchMercadoLibreImage(query);
            let source = 'ML';
            
            // Step 2: Fallback to Bing Web Search
            if (!imgUrl) {
                imgUrl = await searchBingImage(query);
                source = 'WEB';
            }
            
            // Step 3: Last resort fallback URL
            if (!imgUrl) {
                imgUrl = getFallbackImageUrl(query, tenantId);
                source = 'FALLBACK';
            }
            
            // Update in database
            updateStmt.run(imgUrl, prod.id);
            
            return { id: prod.id, codigo: prod.codigo, descripcion: prod.descripcion, url: imgUrl, source };
        });
        
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            processedCount++;
            if (res.source === 'ML') mlCount++;
            else if (res.source === 'WEB') webCount++;
            else fallbackCount++;
            
            console.log(`  [${res.source}] ${res.codigo} - ${res.descripcion.substring(0, 40)}... -> ${res.url.substring(0, 60)}...`);
        });
        
        // Wait 300ms between batches to prevent rate limits
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    console.log(`\nSync finished for ${tenantId.toUpperCase()}:`);
    console.log(`- Updated from Mercado Libre: ${mlCount}`);
    console.log(`- Updated from Web Search (Bing): ${webCount}`);
    console.log(`- Updated from Fallback Category: ${fallbackCount}`);
    console.log(`- Total processed: ${processedCount}`);
}

async function main() {
    try {
        await syncTenantImages('club'); // Sync club first since it is small and quick (141 items)
        await syncTenantImages('importadora'); // Sync importadora next
        console.log("\n=== IMAGE SYNC COMPLETE ===");
    } catch (e) {
        console.error("Main execution failed:", e.message);
    }
}

main();
