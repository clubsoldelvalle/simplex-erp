// APPLICATION STATE
let activeTenant = 'importadora';
let activeView = 'dashboard';
let currentUserId = 'admin';

const getFallbackImageUrl = () => {
    return activeTenant === 'club' 
        ? "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22 viewBox=%220 0 80 80%22><rect width=%2280%22 height=%2280%22 fill=%22%23eff6ff%22 rx=%228%22/><circle cx=%2240%22 cy=%2240%22 r=%2212%22 stroke=%22%233b82f6%22 stroke-width=%223%22 fill=%22none%22/><path d=%22M40 18 L40 28 M40 52 L40 62 M18 40 L28 40 M52 40 L62 40%22 stroke=%22%233b82f6%22 stroke-width=%223%22 stroke-linecap=%22round%22/></svg>"
        : "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22 viewBox=%220 0 80 80%22><rect width=%2280%22 height=%2280%22 fill=%22%23f1f5f9%22 rx=%228%22/><path d=%22M25 30 L55 30 L55 58 L25 58 Z M25 45 L35 38 L45 48 L50 44 L55 50%22 stroke=%22%23cbd5e1%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 fill=%22none%22/><circle cx=%2248%22 cy=%2238%22 r=%223%22 fill=%22%23cbd5e1%22/></svg>";
};

window.updateImagePreview = function(url) {
    const previewImg = document.getElementById('ep-image-preview');
    if (previewImg) {
        previewImg.src = url || getFallbackImageUrl();
    }
};

// Cache for lists
let cacheTerceros = [];
let cachePuc = [];
let cacheInventario = [];
let cacheAsientos = [];
let cacheReservas = [];

// Pagination and Autocomplete cache for inventory
let currentInventarioPage = 1;
let totalInventarioPages = 1;
let inventarioSearchQuery = '';
const autocompleteProductsCache = new Map();

function findProductById(id) {
    id = parseInt(id);
    return cacheInventario.find(p => p.id === id) || autocompleteProductsCache.get(id);
}

// Invoice & Purchase builders state
let invoiceItems = [];
let purchaseItems = [];
let posCart = [];
let lastCreatedInvoiceId = null;

// POS Quick Items
const posQuickCatalog = [
    { id: 'ticket_entrada', codigo: 'ENTRADA', descripcion: 'Entrada General Balneario', precio: 25000, iva: 19, icon: 'fa-ticket' },
    { id: 'ticket_pasadia', codigo: 'PASADIA', descripcion: 'Pasadía Todo Incluido', precio: 65000, iva: 19, icon: 'fa-umbrella-beach' },
    { id: 'ticket_cancha', codigo: 'CANCHA', descripcion: 'Alquiler Cancha 1 Hora', precio: 80000, iva: 19, icon: 'fa-futbol' },
    { id: 'ticket_almuerzo', codigo: 'ALMUERZO', descripcion: 'Almuerzo Ejecutivo', precio: 18000, iva: 19, icon: 'fa-utensils' },
    { id: 'ticket_bebidas', codigo: 'BEBIDA', descripcion: 'Gaseosa / Cerveza Kiosco', precio: 5000, iva: 19, icon: 'fa-beer-mug-empty' }
];

// INIT APPLICATION
let currentCarteraData = [];
let currentProveedoresData = [];

document.addEventListener('DOMContentLoaded', () => {
    // Check if session is active
    const sessionUser = localStorage.getItem('currentUser');
    if (!sessionUser) {
        document.getElementById('login-container').style.display = 'flex';
        document.querySelector('.app-container').style.display = 'none';
    } else {
        const user = JSON.parse(sessionUser);
        initializeAppAfterLogin(user);
    }

    // Check for Mercado Libre vinculation success query param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('ml_success')) {
        alert('¡Cuenta de Mercado Libre vinculada con éxito en Simplix ERP!');
        // Clean URL to avoid repeating alert on reload
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

function initializeAppAfterLogin(user) {
    currentUserId = user.username;
    document.getElementById('login-container').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    document.getElementById('user-display-name').innerText = user.fullName || user.username;
    document.getElementById('user-display-role').innerText = `${user.role}@wo`;

    if (!window.appInitialized) {
        setupNavigation();
        setupTenantSwitcher();
        setupTabs();
        setupAutocompletesAll();
        setupValidationWarnings();
        setupMercadoLibreConsoleTabs();
        setupMercadoLibreSalesTabs();
        window.appInitialized = true;
    }
    
    // Start polling ML questions
    startMercadoLibreQuestionsPolling();
    startMercadoLibreSalesPolling();
    
    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    if (document.getElementById('fac-fecha')) document.getElementById('fac-fecha').value = today;
    if (document.getElementById('com-fecha')) document.getElementById('com-fecha').value = today;
    if (document.getElementById('res-fecha')) document.getElementById('res-fecha').value = today;
    if (document.getElementById('rc-fecha')) document.getElementById('rc-fecha').value = today;
    if (document.getElementById('ce-fecha')) document.getElementById('ce-fecha').value = today;
    if (document.getElementById('cierre-form')) document.getElementById('cierre-form').elements['cie-inicial'].value = 0;

    // Load initial data
    loadCurrentTenantData();

    // Listener para el concepto rápido de la Nota de Contabilidad (mapeo automático inteligente con botón)
    const ncGeneralConcept = document.getElementById('nc-doc-concepto');
    const ncAddConceptBtn = document.getElementById('nc-add-concept-btn');
    
    const handleNcQuickAdd = () => {
        const val = ncGeneralConcept.value.trim();
        if (val) {
            // Buscar la primera fila que no tenga cuenta asignada (o esté vacía)
            let targetIdx = -1;
            for (let i = 0; i < ncRows.length; i++) {
                const searchInput = document.getElementById(`nc-puc-search-${i}`);
                const descInput = document.getElementById(`nc-desc-${i}`);
                // Preferir una fila donde tanto el buscador de cuenta como el concepto estén vacíos
                if (searchInput && !searchInput.value.trim() && descInput && !descInput.value.trim()) {
                    targetIdx = i;
                    break;
                }
            }
            
            // Si no hay ninguna fila completamente vacía, buscar la primera fila donde el buscador PUC esté vacío
            if (targetIdx === -1) {
                for (let i = 0; i < ncRows.length; i++) {
                    const searchInput = document.getElementById(`nc-puc-search-${i}`);
                    if (searchInput && !searchInput.value.trim()) {
                        targetIdx = i;
                        break;
                    }
                }
            }
            
            // Si no hay ninguna fila disponible (todas tienen cuentas seleccionadas), crear una nueva!
            if (targetIdx === -1) {
                addNcGridRow();
                targetIdx = ncRows.length - 1;
            }
            
            if (targetIdx !== -1) {
                const targetDescInput = document.getElementById(`nc-desc-${targetIdx}`);
                if (targetDescInput) {
                    targetDescInput.value = val;
                    // Disparar input para guardar en el estado local de esa fila
                    targetDescInput.dispatchEvent(new Event('input'));
                    // Disparar blur para gatillar la clasificación automática
                    targetDescInput.dispatchEvent(new Event('blur'));
                }
            }
            
            // Limpiar el campo e indicarle al usuario enfocando nuevamente
            ncGeneralConcept.value = '';
            ncGeneralConcept.focus();
        }
    };

    if (ncGeneralConcept && ncAddConceptBtn) {
        ncAddConceptBtn.addEventListener('click', handleNcQuickAdd);
        
        ncGeneralConcept.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleNcQuickAdd();
            }
        });
    }

    // Inicializar listeners del menú desplegable de formas de pago programáticamente
    const ncPaymentBtn = document.getElementById('nc-payment-dropdown-btn');
    const ncPaymentMenu = document.getElementById('nc-payment-dropdown-menu');
    
    if (ncPaymentBtn && ncPaymentMenu) {
        ncPaymentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = ncPaymentMenu.style.display === 'block';
            ncPaymentMenu.style.display = isVisible ? 'none' : 'block';
        });
        
        ncPaymentMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                ncPaymentMenu.style.display = 'none';
                const method = link.getAttribute('data-method');
                addNcQuickContrapartida(method);
            });
        });
    }

    // Cerrar menú desplegable de formas de pago al hacer clic por fuera
    document.addEventListener('click', (e) => {
        if (ncPaymentMenu && ncPaymentBtn && !ncPaymentBtn.contains(e.target) && !ncPaymentMenu.contains(e.target)) {
            ncPaymentMenu.style.display = 'none';
        }
    });

    // Listeners for prefix changes
    const facPrefijo = document.getElementById('fac-prefijo');
    if (facPrefijo) {
        facPrefijo.addEventListener('change', () => loadNextDocumentNumbers());
        facPrefijo.addEventListener('keyup', () => loadNextDocumentNumbers());
    }

    // Initialize sortable keypads
    makeKeypadSortable('#view-dashboard .cashier-keypad', 'simplix_order_dashboard');
    makeKeypadSortable('#view-documentos-hub .cashier-keypad', 'simplix_order_documents');
    makeKeypadSortable('#rep-op-keypad', 'simplix_order_reports');

    // Auto-register tunnel URL to WordPress
    if (window.location.origin.includes('localhost') || window.location.origin.includes('serveousercontent.com') || window.location.origin.includes('serveo.net')) {
        fetch('https://repuestoscajica.com/wp-json/patucarro-sync/v1/update-simplix-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: window.location.origin,
                token: 'Patucarro2026*'
            })
        })
        .then(response => response.json())
        .then(data => console.log('[Tunnel Auto-Register]', data))
        .catch(err => console.error('[Tunnel Auto-Register Error]', err));
    }
}

/**
 * Habilita la reorganización (Drag & Drop) de los botones en una cuadrícula (keypad)
 * con soporte para PC, celulares y persistencia mediante localStorage.
 */
function makeKeypadSortable(containerSelector, storageKey) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    let dragEl = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchDragging = false;
    let wasDragging = false;

    // Helper para obtener el elemento .cashier-key padre más cercano
    function getClosestKey(el) {
        return el.closest('.cashier-key');
    }

    // Cargar y restaurar el orden guardado
    function restoreOrder() {
        const savedOrder = localStorage.getItem(storageKey);
        if (savedOrder) {
            try {
                const order = JSON.parse(savedOrder);
                const items = Array.from(container.children);
                order.forEach(id => {
                    const item = items.find(el => el.getAttribute('data-id') === id);
                    if (item) {
                        container.appendChild(item);
                    }
                });
            } catch (err) {
                console.error("Error al restaurar el orden de los accesos rápidos", err);
            }
        }
    }

    // Guardar el orden actual en localStorage
    function saveOrder() {
        const order = Array.from(container.children)
            .map(el => el.getAttribute('data-id'))
            .filter(Boolean);
        localStorage.setItem(storageKey, JSON.stringify(order));
    }

    // Inicializar Drag & Drop nativo de HTML5 para PC
    Array.from(container.children).forEach(item => {
        item.setAttribute('draggable', 'true');

        item.addEventListener('dragstart', (e) => {
            dragEl = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            wasDragging = true;
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            dragEl = null;
            saveOrder();
            // Limpiar la bandera de arrastre con un leve retraso para bloquear el click
            setTimeout(() => {
                wasDragging = false;
            }, 50);
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = getClosestKey(e.target);
            if (target && target !== dragEl && target.parentNode === container) {
                const rect = target.getBoundingClientRect();
                const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                container.insertBefore(dragEl, next ? target.nextSibling : target);
            }
        });
    });

    // Soporte para eventos táctiles (celulares/tablets)
    container.addEventListener('touchstart', (e) => {
        const target = getClosestKey(e.target);
        if (target && target.parentNode === container) {
            dragEl = target;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isTouchDragging = false;
        }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!dragEl) return;
        
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        
        // Si el movimiento supera los 8px, se considera arrastre
        if (!isTouchDragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            isTouchDragging = true;
            wasDragging = true;
            dragEl.classList.add('dragging');
        }
        
        if (isTouchDragging) {
            if (e.cancelable) {
                e.preventDefault(); // Evitar desplazamiento de página
            }
            
            const elementOver = document.elementFromPoint(touch.clientX, touch.clientY);
            if (!elementOver) return;

            const target = getClosestKey(elementOver);
            if (target && target !== dragEl && target.parentNode === container) {
                const rect = target.getBoundingClientRect();
                const next = (touch.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                container.insertBefore(dragEl, next ? target.nextSibling : target);
            }
        }
    }, { passive: false });

    container.addEventListener('touchend', (e) => {
        if (dragEl) {
            dragEl.classList.remove('dragging');
            if (isTouchDragging) {
                saveOrder();
                // Prevenir el comportamiento por defecto del toque (el click)
                e.preventDefault();
            }
            dragEl = null;
            isTouchDragging = false;
            
            setTimeout(() => {
                wasDragging = false;
            }, 50);
        }
    });

    // Interceptar y cancelar clics accidentales si hubo arrastre (fase de captura)
    container.addEventListener('click', (e) => {
        if (wasDragging) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // Restaurar orden al cargar
    restoreOrder();
}


// SPA NAVIGATION SETUP
function setupNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.getAttribute('data-view');
            changeView(view);
        });
    });
}

function toggleSidebarMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
        document.body.classList.toggle('menu-active');
    }
}

function changeView(viewName) {
    activeView = viewName;
    
    // Close sidebar on mobile if open
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
        document.body.classList.remove('menu-active');
    }
    if (overlay && overlay.classList.contains('active')) {
        overlay.classList.remove('active');
    }
    
    // Update active class in menu
    document.querySelectorAll('.menu-item').forEach(item => {
        if (item.getAttribute('data-view') === viewName) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Update active view panel
    document.querySelectorAll('.view-panel').forEach(panel => {
        if (panel.id === `view-${viewName}`) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });

    // Set view title
    const titles = {
        dashboard: 'Dashboard General',
        terceros: 'Ficha Única de Terceros',
        puc: 'Catálogo de Cuentas PUC (NIIF)',
        inventario: activeTenant === 'importadora' ? 'Inventario de Autopartes' : 'Inventario de Servicios / Kiosco',
        facturacion: 'Facturación Electrónica DIAN',
        compras: 'Documento Soporte Electrónico',
        taquilla: 'Taquilla POS Rápido',
        reservas: 'Reservas de Cancha & Eventos',
        tesoreria: 'Tesorería & Cajas',
        reportes: 'Reportes Financieros (World Office)',
        'reportes-operacionales': 'Ficha de Informes Operativos',
        exogena: 'Estructurador de Exógena DIAN',
        config: 'Configuración y Migración SQL',
        mercadolibre: 'Preguntas de Mercado Libre',
        'mercadolibre-ventas': 'Ventas de Mercado Libre',
        'documentos-hub': 'Elaborar Documento Contable',
        'comprobante-egreso-doc': 'Elaborar Comprobante de Egreso (CE)',
        'recibo-caja-doc': 'Elaborar Recibo de Caja (RC)',
        'nomina-doc': 'Liquidación de Nómina (NM)',
        'nota-contabilidad-doc': 'Nota de Contabilidad (NC)',
        'consulta-documentos': 'Consulta de Documentos Contables',
        usuarios: 'Inscribir Usuarios (Nómina y Acceso)'
    };
    document.getElementById('view-title').innerText = titles[viewName] || 'SIMPLIX ERP';

    // Load dynamic data based on view
    if (viewName === 'dashboard') updateDashboardMetrics();
    else if (viewName === 'terceros') loadTerceros();
    else if (viewName === 'puc') loadPuc();
    else if (viewName === 'inventario') loadInventario();
    else if (viewName === 'facturacion') prepareFacturacionView();
    else if (viewName === 'compras') prepareComprasView();
    else if (viewName === 'taquilla') prepareTaquillaView();
    else if (viewName === 'reservas') loadReservas();
    else if (viewName === 'tesoreria') loadTesoreriaView();
    else if (viewName === 'reportes') loadReportsView();
    else if (viewName === 'reportes-operacionales') loadReportesOperacionalesView();
    else if (viewName === 'comprobante-egreso-doc') prepareCeDocView();
    else if (viewName === 'recibo-caja-doc') prepareRcDocView();
    else if (viewName === 'nomina-doc') prepareNmDocView();
    else if (viewName === 'nota-contabilidad-doc') prepareNcDocView();
    else if (viewName === 'consulta-documentos') prepareConsultaDocsView();
    else if (viewName === 'usuarios') loadUsuarios();
    else if (viewName === 'config') loadConfigView();
    else if (viewName === 'mercadolibre') loadMercadoLibreConsoleView();
    else if (viewName === 'mercadolibre-ventas') loadMercadoLibreSalesView();
}

// TENANT SWITCHER
function setupTenantSwitcher() {
    const selector = document.getElementById('tenant-toggle');
    selector.addEventListener('click', (e) => {
        const option = e.target.closest('.tenant-option');
        if (!option) return;
        
        const tenant = option.getAttribute('data-id');
        if (tenant === activeTenant) return;

        // Toggle active option UI
        selector.querySelectorAll('.tenant-option').forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        
        activeTenant = tenant;
        document.body.setAttribute('data-tenant', tenant);

        // Reset view to dashboard when changing tenant
        changeView('dashboard');
        
        // Refresh all cached data
        loadCurrentTenantData();
    });
}

function loadCurrentTenantData() {
    const prefijoInput = document.getElementById('fac-prefijo');
    if (prefijoInput) {
        prefijoInput.value = (activeTenant === 'importadora') ? 'FVE' : 'FV';
    }

    // Background preload
    fetchApi(`/${activeTenant}/terceros`).then(data => cacheTerceros = data);
    fetchApi(`/${activeTenant}/puc`).then(data => cachePuc = data);
    fetchApi(`/${activeTenant}/asientos`).then(data => cacheAsientos = data);
    fetchApi(`/${activeTenant}/reservas`).then(data => cacheReservas = data);
    updateDashboardMetrics();
    clearAutocompleteFields();
    loadNextDocumentNumbers();
}

// TAB NAVIGATION SETUP (Tesoreria & Reportes)
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const container = btn.parentElement;
            container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tabName = btn.getAttribute('data-tab');
            const tabContentArea = container.nextElementSibling;
            
            // Hide all tab contents in parent hierarchy
            let sibling = container.nextElementSibling;
            while(sibling && sibling.classList.contains('tab-content')) {
                if (sibling.id === tabName || sibling.id === 'tab-' + tabName) {
                    sibling.classList.add('active');
                } else {
                    sibling.classList.remove('active');
                }
                sibling = sibling.nextElementSibling;
            }
        });
    });
}

// HTTP API CALLS
const getApiBase = () => {
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') {
        return '/api';
    }
    if (path.includes('/public/')) {
        const idx = path.indexOf('/public/');
        return path.substring(0, idx) + '/api';
    }
    if (path.endsWith('/')) {
        return path + 'api';
    }
    const lastSlash = path.lastIndexOf('/');
    return path.substring(0, lastSlash) + '/api';
};
const API_BASE = getApiBase().replace(/\/+/g, '/');

async function fetchApi(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    if (options.body && typeof options.body === 'object') {
        options.body = JSON.stringify(options.body);
    }
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    
    let response;
    try {
        response = await fetch(url, { ...options, headers });
    } catch (networkError) {
        throw new Error(`Error de red: No se pudo conectar al servidor (${networkError.message})`);
    }

    const contentType = response.headers.get('content-type') || '';
    let responseText = '';
    try {
        responseText = await response.text();
    } catch (readError) {
        responseText = '';
    }

    let parsedData = null;
    let jsonParseError = null;
    if (contentType.includes('application/json') || responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
        if (responseText.trim().length > 0) {
            try {
                parsedData = JSON.parse(responseText);
            } catch (e) {
                jsonParseError = e;
            }
        }
    }

    if (!response.ok) {
        if (parsedData && parsedData.error) {
            throw new Error(parsedData.error);
        }
        const errorMsg = responseText.trim() ? responseText.trim().substring(0, 150) : `Error HTTP ${response.status} (${response.statusText})`;
        throw new Error(errorMsg);
    }

    if (jsonParseError) {
        console.error('Error al decodificar JSON del servidor:', jsonParseError, 'Respuesta cruda:', responseText);
        throw new Error(`Respuesta JSON malformada del servidor: ${jsonParseError.message}`);
    }

    return parsedData !== null ? parsedData : {};
}

// FORMATTERS
function formatMoney(value) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0
    }).format(value);
}

// --- MODULE: DASHBOARD ---
async function updateDashboardMetrics() {
    try {
        const asientos = await fetchApi(`/${activeTenant}/asientos`);
        cacheAsientos = asientos;
        
        let ingresos = 0;
        let egresos = 0;
        let dianApproved = 0;
        let dianTotal = 0;

        asientos.forEach(as => {
            if (as.anulado === 1) return;
            if (as.tipo_documento === 'FV' || as.tipo_documento === 'RC') {
                ingresos += as.total_documento;
            }
            if (as.tipo_documento === 'DS' || as.tipo_documento === 'CE') {
                egresos += as.total_documento;
            }
            if (as.tipo_documento === 'FV') {
                dianTotal++;
                if (as.dian_estado === 'ENVIADO') dianApproved++;
            }
        });

        const elIngresos = document.getElementById('dash-ingresos');
        if (elIngresos) elIngresos.innerText = formatMoney(ingresos);
        
        const elEgresos = document.getElementById('dash-egresos');
        if (elEgresos) elEgresos.innerText = formatMoney(egresos);
        
        const elDian = document.getElementById('dash-dian-count');
        if (elDian) elDian.innerText = `${dianApproved} / ${dianTotal}`;

        // Stock alerts count
        const alertRes = await fetchApi(`/${activeTenant}/inventario/low-stock-count`);
        const alertsCount = alertRes.count;
        
        const elStockAlerts = document.getElementById('dash-stock-alerts');
        if (elStockAlerts) elStockAlerts.innerText = alertsCount;
        
        const alertCard = document.getElementById('dash-alert-card');
        if (alertCard) {
            if (alertsCount > 0) {
                alertCard.classList.add('alert-card');
            } else {
                alertCard.classList.remove('alert-card');
            }
        }

        // Update inventory tab alerts card
        const elInvStockAlerts = document.getElementById('inv-stock-alerts');
        if (elInvStockAlerts) elInvStockAlerts.innerText = alertsCount;
        
        const invAlertCard = document.getElementById('inv-alert-card');
        if (invAlertCard) {
            if (alertsCount > 0) {
                invAlertCard.style.border = '1px solid #ef4444';
                invAlertCard.style.backgroundColor = 'rgba(239, 68, 68, 0.05)';
            } else {
                invAlertCard.style.border = '1px solid var(--border)';
                invAlertCard.style.backgroundColor = 'var(--bg-card)';
            }
        }

        // Render recent asientos
        const tbody = document.getElementById('dash-recent-asientos');
        tbody.innerHTML = '';
        asientos.slice(0, 10).forEach(as => {
            const stateBadges = {
                'NO_APLICA': '<span class="badge">N/A</span>',
                'PENDIENTE': '<span class="badge badge-pending">Pendiente</span>',
                'ENVIADO': '<span class="badge badge-success">Aprobado DIAN</span>',
                'CONTINGENCIA': '<span class="badge badge-alert">Contingencia</span>'
            };

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><a href="#" onclick="viewAsientoDetails(${as.id}); return false;" style="font-weight: bold; color: var(--primary); text-decoration: underline;">${as.tipo_documento}-${as.numero}</a></td>
                <td>${as.fecha}</td>
                <td>${as.concepto || 'Transacción contable'}</td>
                <td>${formatMoney(as.total_documento)}</td>
                <td>${stateBadges[as.dian_estado] || as.dian_estado}</td>
                <td>
                    <button class="btn btn-secondary" onclick="viewAsientoDetails(${as.id})">
                        <i class="fa-solid fa-eye"></i> Ver
                    </button>
                    ${as.anulado === 0 ? `<button class="btn btn-secondary" onclick="voidDocument(${as.id})"><i class="fa-solid fa-ban"></i> Anular</button>` : '<span style="color:red; font-weight:bold;">Anulado</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error('Failed to load dashboard metrics:', e);
    }
}

// --- MODULE: TERCEROS ---
function filterTerceros() {
    const q = document.getElementById('terceros-search').value.toLowerCase();
    renderTerceros(cacheTerceros.filter(t => 
        t.nombre.toLowerCase().includes(q) || 
        (t.apellidos && t.apellidos.toLowerCase().includes(q)) ||
        t.identificacion.includes(q) ||
        (t.telefono && t.telefono.includes(q))
    ));
}

function renderTerceros(list) {
    const tbody = document.getElementById('terceros-table-body');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No se encontraron terceros</td></tr>';
        return;
    }

    list.forEach(t => {
        const roles = [];
        if (t.tipo_cliente) roles.push('Cliente');
        if (t.tipo_proveedor) roles.push('Proveedor');
        if (t.tipo_empleado) roles.push('Empleado');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${t.tipo_identificacion} ${t.identificacion}-${t.dv || ''}</strong></td>
            <td>${t.nombre} ${t.apellidos || ''}</td>
            <td>${t.direccion || ''} (${t.ciudad || ''})</td>
            <td>${t.telefono || ''}</td>
            <td>${t.email || ''}</td>
            <td>${t.aplica_rete_ica ? `ReteICA (${t.tarifa_ica || '0.966'}%)` : 'No aplica'}</td>
            <td>${roles.join(', ')}</td>
            <td><span class="badge ${t.activo ? 'badge-success' : ''}">${t.activo ? 'Activo' : 'Inactivo'}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadTerceros() {
    try {
        const data = await fetchApi(`/${activeTenant}/terceros`);
        cacheTerceros = data;
        renderTerceros(data);
    } catch (e) {
        alert('Error al cargar terceros: ' + e.message);
    }
}

// NIT VERIFICATION DIGIT CALCULATOR (Módulo 11)
function calculateDV() {
    const nitInput = document.getElementById('t-doc').value.trim();
    if (!nitInput || isNaN(nitInput)) {
        document.getElementById('t-dv').value = '';
        return;
    }
    const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let sum = 0;
    const l = nitInput.length;
    for (let i = 0; i < l; i++) {
        const digit = parseInt(nitInput.charAt(l - 1 - i));
        sum += digit * weights[i];
    }
    const remainder = sum % 11;
    let dv = 0;
    if (remainder > 1) {
        dv = 11 - remainder;
    } else {
        dv = remainder;
    }
    document.getElementById('t-dv').value = dv;
}

function toggleTarifIca(chk) {
    document.getElementById('t-tarifa-ica-group').style.display = chk.checked ? 'block' : 'none';
}

async function submitNewTercero(e) {
    e.preventDefault();
    const form = document.getElementById('tercero-form');
    const body = {
        tipo_identificacion: form.elements['t-tipo-doc'].value,
        identificacion: form.elements['t-doc'].value.trim(),
        dv: form.elements['t-dv'].value,
        nombre: form.elements['t-nombre'].value.trim(),
        apellidos: form.elements['t-apellidos'].value.trim() || null,
        direccion: form.elements['t-direccion'].value.trim() || null,
        ciudad: form.elements['t-ciudad'].value.trim() || 'Bogotá',
        telefono: form.elements['t-telefono'].value.trim() || null,
        email: form.elements['t-email'].value.trim() || null,
        tipo_cliente: form.elements['t-cliente'].checked ? 1 : 0,
        tipo_proveedor: form.elements['t-proveedor'].checked ? 1 : 0,
        tipo_empleado: 0,
        aplica_rete_ica: form.elements['t-reteica'].checked ? 1 : 0,
        tarifa_ica: form.elements['t-reteica'].checked ? parseFloat(form.elements['t-tarifa-ica'].value) || 0.00966 : 0,
        activo: 1,
        usuario: 'admin'
    };

    try {
        await fetchApi(`/${activeTenant}/terceros`, { method: 'POST', body });
        closeModal('tercero-modal');
        form.reset();
        loadTerceros();
    } catch (e) {
        alert('Error al registrar tercero: ' + e.message);
    }
}

// --- MODULE: PUC ---
function filterPuc() {
    const q = document.getElementById('puc-search').value.toLowerCase();
    renderPuc(cachePuc.filter(p => p.codigo.includes(q) || p.nombre.toLowerCase().includes(q)));
}

function renderPuc(list) {
    const tbody = document.getElementById('puc-table-body');
    tbody.innerHTML = '';
    list.slice(0, 100).forEach(p => { // limit to 100 rows for view performance
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.codigo}</strong></td>
            <td>${p.nombre}</td>
            <td>${p.requiere_tercero ? '<i class="fa-solid fa-check text-success"></i> Sí' : 'No'}</td>
            <td>${p.requiere_centro_costo ? '<i class="fa-solid fa-check text-success"></i> Sí' : 'No'}</td>
            <td>${p.codigo.charAt(0)}</td>
            <td><span class="badge badge-success">Activo</span></td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadPuc() {
    try {
        const data = await fetchApi(`/${activeTenant}/puc`);
        cachePuc = data;
        renderPuc(data);
    } catch (e) {
        alert('Error al cargar PUC: ' + e.message);
    }
}

async function submitNewPuc(e) {
    e.preventDefault();
    const form = document.getElementById('puc-form');
    const body = {
        codigo: form.elements['p-codigo'].value.trim(),
        nombre: form.elements['p-nombre'].value.trim().toUpperCase(),
        requiere_tercero: form.elements['p-tercero'].checked ? 1 : 0,
        requiere_centro_costo: form.elements['p-cc'].checked ? 1 : 0,
        parent_codigo: form.elements['p-parent'].value.trim() || null,
        usuario: 'admin'
    };

    try {
        await fetchApi(`/${activeTenant}/puc`, { method: 'POST', body });
        closeModal('puc-modal');
        form.reset();
        loadPuc();
    } catch (e) {
        alert('Error al registrar cuenta PUC: ' + e.message);
    }
}

// --- MODULE: INVENTARIO ---
let inventarioSearchTimeout;
function filterInventario() {
    clearTimeout(inventarioSearchTimeout);
    inventarioSearchTimeout = setTimeout(() => {
        const q = document.getElementById('inventario-search').value.trim();
        loadInventario(1, q);
    }, 300);
}

function renderInventario(list) {
    const tbody = document.getElementById('inventario-table-body');
    tbody.innerHTML = '';
    
    list.forEach(item => {
        const isCritical = item.activo && item.stock_actual <= item.stock_minimo;
        const tr = document.createElement('tr');
        if (isCritical && !item.is_unlinked) tr.classList.add('alert-row');
        
        const fallbackUrl = getFallbackImageUrl();
        const imgUrl = item.imagen_url || fallbackUrl;
        
        let mlBadgeHtml = '';
        if (activeTenant === 'importadora' && item.ml_status) {
            if (item.ml_status === 'active') {
                mlBadgeHtml = '<span class="badge" style="background-color:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.3); font-size:10px; margin-left:6px; padding:2px 4px; border-radius:4px; font-weight:700;"><i class="fa-solid fa-store"></i> ML Activo</span>';
            } else if (item.ml_status === 'paused') {
                mlBadgeHtml = '<span class="badge" style="background-color:rgba(245,158,11,0.12); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); font-size:10px; margin-left:6px; padding:2px 4px; border-radius:4px; font-weight:700;"><i class="fa-solid fa-pause"></i> ML Pausado</span>';
            } else if (item.ml_status === 'deleted') {
                mlBadgeHtml = '<span class="badge" style="background-color:rgba(239,68,68,0.12); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-size:10px; margin-left:6px; padding:2px 4px; border-radius:4px; font-weight:700;"><i class="fa-solid fa-trash-can"></i> ML Eliminado</span>';
            }
        }

        const linkCodeHtml = item.is_unlinked 
            ? `<span style="font-family: monospace; color: #64748b; font-weight: 700;">${item.codigo}</span>` 
            : `<a href="#" onclick="viewProductKardex(${item.id}); return false;" style="font-weight: 700; color: var(--primary); text-decoration: underline; font-family: monospace;">${item.codigo}</a>`;
            
        const linkDescHtml = item.is_unlinked 
            ? `<span style="color: #64748b; font-style: italic;">${item.descripcion}</span>${mlBadgeHtml}` 
            : `<a href="#" onclick="viewProductKardex(${item.id}); return false;" style="font-weight: 600; color: var(--text-main); text-decoration: underline;">${item.descripcion}</a>${mlBadgeHtml}`;

        tr.innerHTML = `
            <td>
                <img src="${imgUrl}" style="width:40px; height:40px; object-fit:cover; border-radius:4px; border: 1px solid var(--border-color, #ddd); cursor: pointer;" onclick="zoomImage('${imgUrl}')" onerror="this.onerror=null; this.src='${fallbackUrl}'" />
            </td>
            <td>
                ${item.is_unlinked ? `
                    <button class="btn btn-primary" onclick="openLinkingModal('${item.codigo}', '${item.descripcion.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 11px;">
                        <i class="fa-solid fa-link"></i> Vincular
                    </button>
                ` : `
                    <button class="btn btn-primary" onclick="openEditProductModal(${item.id})" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; background-color: var(--primary);" title="Editar Ficha Contable y Sincronizar Canales">
                        <i class="fa-solid fa-pen-to-square"></i> Editar
                    </button>
                `}
            </td>
            <td>${linkCodeHtml}</td>
            <td>${linkDescHtml}</td>
            <td class="importadora-only">${item.is_unlinked ? 'Mercado Libre' : (item.marca || 'N/A')}</td>
            <td class="importadora-only">${item.is_unlinked ? 'Sin vinculación local' : (item.compatibilidad || 'N/A')}</td>
            <td><strong>${item.is_unlinked ? '--' : item.stock_actual}</strong></td>
            <td>${item.is_unlinked ? '--' : item.stock_minimo}</td>
            <td>${formatMoney(item.precio_venta)}</td>
            <td>${item.is_unlinked ? '--' : (item.iva_tarifa < 1 ? Math.round(item.iva_tarifa * 100) : item.iva_tarifa) + '%'}</td>
            <td>${item.is_unlinked ? '<span class="badge" style="background: #e2e8f0; color: #475569;">No Vinculado</span>' : (isCritical ? '<span class="badge badge-alert"><i class="fa-solid fa-triangle-exclamation"></i> Stock Bajo</span>' : '<span class="badge badge-success">OK</span>')}</td>
            <td>
                ${item.is_unlinked ? `
                    <button class="btn btn-primary" onclick="openLinkingModal('${item.codigo}', '${item.descripcion.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 11px;">
                        <i class="fa-solid fa-link"></i> Vincular
                    </button>
                ` : `
                    <button class="btn btn-secondary" onclick="adjustStockModal(${item.id})" style="padding: 4px 8px; font-size: 11px;">
                        <i class="fa-solid fa-plus-minus"></i> Ajustar
                    </button>
                `}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.openLinkingModal = async function(mcoId, title) {
    const localSku = prompt(`Vincular publicación ${mcoId} ("${title}")\n\nIngrese la Referencia/SKU del producto local en Simplix ERP al cual desea vincular esta publicación:`);
    if (!localSku) return;
    
    try {
        const res = await fetchApi(`/${activeTenant}/mercadolibre/link-item`, {
            method: 'POST',
            body: {
                itemId: mcoId,
                sku: localSku.trim(),
                title: title,
                usuario: currentUserId || 'admin'
            }
        });
        if (res.success) {
            alert('¡Publicación vinculada con éxito!');
            loadInventario();
        } else {
            alert('Error al vincular: ' + res.error);
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function openMobileAccessModal() {
    let accessUrl = window.location.origin;
    
    // If running locally, fetch the server's actual LAN IP address
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            const sysInfo = await fetchApi('/system-info');
            if (sysInfo && sysInfo.localIp) {
                accessUrl = `http://${sysInfo.localIp}:${sysInfo.port}`;
            }
        } catch (e) {
            console.warn('Failed to fetch system info, using window location:', e);
        }
    }
    
    document.getElementById('mobile-access-link').href = accessUrl;
    document.getElementById('mobile-access-link-text').innerText = accessUrl;
    
    // Generate QR Code dynamically
    const qrImg = document.getElementById('mobile-access-qr');
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(accessUrl)}`;
    
    showModal('mobile-access-modal');
}

function zoomImage(url) {
    const zoomedImg = document.getElementById('zoomed-image-src');
    if (zoomedImg) {
        zoomedImg.src = url;
        showModal('image-zoom-modal');
    }
}

function viewProductImage(url) {
    if (!url) {
        alert("Este producto no tiene imagen registrada.");
        return;
    }
    zoomImage(url);
}

async function loadInventario(page = 1, q = '') {
    currentInventarioPage = page;
    inventarioSearchQuery = q;
    
    // Sincronizar input numérico de página si existe
    const pageInput = document.getElementById('inventario-current-page');
    if (pageInput) pageInput.value = page;

    try {
        const filterEl = document.getElementById('inventario-ml-status-filter');
        const mlStatus = filterEl ? filterEl.value : '';

        const paramsObj = {
            page: page,
            limit: 20,
            q: q
        };
        if (mlStatus) {
            paramsObj.ml_status = mlStatus;
        }
        const queryParams = new URLSearchParams(paramsObj);
        
        const resData = await fetchApi(`/${activeTenant}/inventario?${queryParams.toString()}`);
        cacheInventario = resData.items || [];
        totalInventarioPages = resData.totalPages || 1;
        
        renderInventario(cacheInventario);

        // Update low stock alerts count inside inventory view
        try {
            const alertRes = await fetchApi(`/${activeTenant}/inventario/low-stock-count`);
            const alertsCount = alertRes.count;
            const elInvStockAlerts = document.getElementById('inv-stock-alerts');
            if (elInvStockAlerts) elInvStockAlerts.innerText = alertsCount;
            
            const invAlertCard = document.getElementById('inv-alert-card');
            if (invAlertCard) {
                if (alertsCount > 0) {
                    invAlertCard.style.border = '1px solid #ef4444';
                    invAlertCard.style.backgroundColor = 'rgba(239, 68, 68, 0.05)';
                } else {
                    invAlertCard.style.border = '1px solid var(--border)';
                    invAlertCard.style.backgroundColor = 'var(--bg-card)';
                }
            }
        } catch (err) {
            console.error('Error loading stock alerts:', err);
        }

        // Actualizar datos de paginación en UI
        const totalItems = resData.total || 0;
        const limit = resData.limit || 20;
        const fromItem = totalItems === 0 ? 0 : (page - 1) * limit + 1;
        const toItem = Math.min(page * limit, totalItems);

        const infoDiv = document.getElementById('inventario-pagination-info');
        if (infoDiv) {
            infoDiv.innerText = `Mostrando ${fromItem}-${toItem} de ${totalItems} productos`;
        }
        
        const totalSpan = document.getElementById('inventario-total-pages');
        if (totalSpan) {
            totalSpan.innerText = totalInventarioPages;
        }

        // Habilitar/Deshabilitar botones
        const prevBtn = document.getElementById('btn-inventario-prev');
        if (prevBtn) prevBtn.disabled = page <= 1;
        
        const nextBtn = document.getElementById('btn-inventario-next');
        if (nextBtn) nextBtn.disabled = page >= totalInventarioPages;

        // Auto-sync in the background if 5 minutes passed (only for 'importadora')
        if (activeTenant === 'importadora' && !window.mlSyncing) {
            const lastSync = localStorage.getItem('simplix_last_ml_sync');
            const now = Date.now();
            if (!lastSync || (now - parseInt(lastSync)) > 300000) { // 5 minutes
                triggerBackgroundMlSync();
            }
        }

    } catch (e) {
        alert('Error al cargar inventario: ' + e.message);
    }
}

function changeInventarioPage(offset) {
    const targetPage = currentInventarioPage + offset;
    if (targetPage >= 1 && targetPage <= totalInventarioPages) {
        loadInventario(targetPage, inventarioSearchQuery);
    }
}

function goToInventarioPage(pageVal) {
    let targetPage = parseInt(pageVal);
    if (isNaN(targetPage) || targetPage < 1) targetPage = 1;
    if (targetPage > totalInventarioPages) targetPage = totalInventarioPages;
    loadInventario(targetPage, inventarioSearchQuery);
}

async function submitNewInventario(e) {
    e.preventDefault();
    const form = document.getElementById('inventario-form');
    const body = {
        codigo: form.elements['i-codigo'].value.trim(),
        descripcion: form.elements['i-descripcion'].value.trim(),
        marca: activeTenant === 'importadora' ? form.elements['i-marca'].value.trim() || null : null,
        compatibilidad: activeTenant === 'importadora' ? form.elements['i-compatibilidad'].value.trim() || null : null,
        stock_actual: parseFloat(form.elements['i-stock'].value) || 0,
        stock_minimo: parseFloat(form.elements['i-stock-min'].value) || 0,
        precio_venta: parseFloat(form.elements['i-precio'].value) || 0,
        costo: parseFloat(form.elements['i-costo'].value) || 0,
        iva_tarifa: parseInt(form.elements['i-iva'].value) || 0,
        activo: 1,
        usuario: 'admin'
    };

    try {
        const res = await fetchApi(`/${activeTenant}/inventario`, { method: 'POST', body });
        closeModal('inventario-modal');
        form.reset();
        loadInventario();
        if (res && res.warning) {
            showForbiddenMlWarning(body.codigo, body.descripcion);
        }
    } catch (e) {
        alert('Error al registrar item: ' + e.message);
    }
}

function showForbiddenMlWarning(sku, description) {
    document.getElementById('forbidden-smo-sku').innerText = sku;
    document.getElementById('forbidden-smo-desc').innerText = description;
    showModal('ml-forbidden-smo-modal');
}

function adjustStockModal(id) {
    const product = findProductById(id);
    if (!product) return;
    const newStock = prompt(`Ajustar stock para ${product.descripcion} (Stock actual: ${product.stock_actual}):`, product.stock_actual);
    if (newStock === null || isNaN(newStock)) return;
    
    const body = {
        ...product,
        stock_actual: parseFloat(newStock),
        usuario: 'admin'
    };

    fetchApi(`/${activeTenant}/inventario`, { method: 'POST', body })
        .then(() => loadInventario())
        .catch(e => alert(e.message));
}

let currentEditProduct = null;

window.showEditProductTab = function(tabName) {
    // Hide all tab contents
    document.querySelectorAll('#edit-product-modal .edit-tab-content').forEach(el => {
        el.classList.remove('active');
    });
    // Deactivate all tab buttons
    document.querySelectorAll('#edit-product-modal .edit-tab-btn').forEach(el => {
        el.classList.remove('active');
    });
    
    // Show selected content and activate tab button
    const targetContent = document.getElementById(`edit-tab-${tabName}`);
    if (targetContent) {
        targetContent.classList.add('active');
    }
    const targetBtn = document.getElementById(`tab-btn-${tabName}`);
    if (targetBtn) {
        targetBtn.classList.add('active');
    }
};

window.openEditProductModal = function(id) {
    const product = findProductById(id);
    if (!product) {
        alert("No se encontró el producto.");
        return;
    }
    currentEditProduct = product;
    
    // Reset to general tab
    showEditProductTab('general');
    
    // 1. Populate form fields
    document.getElementById('ep-codigo').value = product.codigo || '';
    document.getElementById('ep-descripcion').value = product.descripcion || '';
    document.getElementById('ep-marca').value = product.marca || '';
    document.getElementById('ep-modelo').value = product.modelo || '';
    document.getElementById('ep-numero-pieza').value = product.numero_pieza || '';
    document.getElementById('ep-gtin').value = product.gtin || '';
    document.getElementById('ep-condicion').value = product.condicion || 'new';
    document.getElementById('ep-compatibilidad').value = product.compatibilidad || '';
    document.getElementById('ep-stock').value = product.stock_actual || 0;
    document.getElementById('ep-stock-min').value = product.stock_minimo || 0;
    document.getElementById('ep-activo').value = product.activo ? "1" : "0";
    document.getElementById('ep-precio').value = product.precio_venta || 0;
    document.getElementById('ep-costo').value = product.costo || 0;
    document.getElementById('ep-iva').value = product.iva_tarifa || 19;
    
    // Image url, previews and detail texts
    const fallbackUrl = getFallbackImageUrl();
    document.getElementById('ep-imagen-url').value = product.imagen_url || '';
    document.getElementById('ep-image-preview').src = product.imagen_url || fallbackUrl;
    
    document.getElementById('ep-imagenes-adicionales').value = product.imagenes_adicionales || '';
    document.getElementById('ep-descripcion-detallada').value = product.descripcion_detallada || '';
    document.getElementById('ep-warranty-type').value = product.warranty_type || 'seller_warranty';
    document.getElementById('ep-warranty-time').value = product.warranty_time || '';
    
    // Default AI prompt to description
    document.getElementById('ai-img-prompt').value = product.descripcion || '';
    // Hide AI Image Helper block initially
    document.getElementById('ai-image-helper-section').style.display = 'none';
    document.getElementById('ai-img-results').innerHTML = '';
    
    // Hide/show importadora details
    const isImportadora = activeTenant === 'importadora';
    document.querySelectorAll('#edit-product-modal .importadora-only').forEach(el => {
        el.style.display = isImportadora ? 'block' : 'none';
    });
    
    // 2. Render initial omnichannel channels status list
    const isLinkedToMl = !!product.ml_status;
    const channelsListContainer = document.getElementById('channel-sync-list-container');
    
    const mlStatusLabel = isLinkedToMl ? 'Vinculado' : 'No Vinculado';
    const mlBadgeClass = isLinkedToMl ? 'badge-success' : 'badge-skipped';
    const mlIcon = 'fa-solid fa-store';
    const mlColor = '#eab308'; // ML Yellow
    
    const wpStatusLabel = isImportadora ? 'Conectado' : 'No Configurado';
    const wpBadgeClass = isImportadora ? 'badge-pending' : 'badge-skipped';
    
    channelsListContainer.innerHTML = `
        <div class="channel-row" id="chan-local">
            <div class="channel-left">
                <div class="channel-icon-circle" style="background-color: var(--primary);"><i class="fa-solid fa-database"></i></div>
                <div class="channel-details">
                    <span class="channel-name-txt">Base de Datos Local (SQLite)</span>
                    <span class="channel-status-msg" id="chan-msg-local">Conexión activa</span>
                </div>
            </div>
            <span class="channel-badge badge-success" id="chan-badge-local">Listo</span>
        </div>
        <div class="channel-row" id="chan-ml">
            <div class="channel-left">
                <div class="channel-icon-circle" style="background-color: ${mlColor};"><i class="${mlIcon}"></i></div>
                <div class="channel-details">
                    <span class="channel-name-txt">Mercado Libre</span>
                    <span class="channel-status-msg" id="chan-msg-ml">${isLinkedToMl ? `Publicación vinculada (Estado: ${product.ml_status})` : 'Sin publicación vinculada'}</span>
                </div>
            </div>
            <span class="channel-badge ${mlBadgeClass}" id="chan-badge-ml">${mlStatusLabel}</span>
        </div>
        <div class="channel-row" id="chan-wp">
            <div class="channel-left">
                <div class="channel-icon-circle" style="background-color: #21759b;"><i class="fa-brands fa-wordpress"></i></div>
                <div class="channel-details">
                    <span class="channel-name-txt">WordPress (WooCommerce)</span>
                    <span class="channel-status-msg" id="chan-msg-wp">repuestoscajica.com/wp-json</span>
                </div>
            </div>
            <span class="channel-badge ${wpBadgeClass}" id="chan-badge-wp">${wpStatusLabel}</span>
        </div>
        <div class="channel-row" id="chan-fb">
            <div class="channel-left">
                <div class="channel-icon-circle" style="background-color: #1877f2;"><i class="fa-brands fa-facebook"></i></div>
                <div class="channel-details">
                    <span class="channel-name-txt">Facebook Catalog</span>
                    <span class="channel-status-msg" id="chan-msg-fb">Meta Pixel Integración</span>
                </div>
            </div>
            <span class="channel-badge badge-pending" id="chan-badge-fb">Pendiente</span>
        </div>
        <div class="channel-row" id="chan-ig">
            <div class="channel-left">
                <div class="channel-icon-circle" style="background-color: #c13584;"><i class="fa-brands fa-instagram"></i></div>
                <div class="channel-details">
                    <span class="channel-name-txt">Instagram Shopping</span>
                    <span class="channel-status-msg" id="chan-msg-ig">Catálogo de tienda social</span>
                </div>
            </div>
            <span class="channel-badge badge-pending" id="chan-badge-ig">Pendiente</span>
        </div>
        <div class="channel-row" id="chan-tt">
            <div class="channel-left">
                <div class="channel-icon-circle" style="background-color: #000000;"><i class="fa-brands fa-tiktok"></i></div>
                <div class="channel-details">
                    <span class="channel-name-txt">TikTok Shop</span>
                    <span class="channel-status-msg" id="chan-msg-tt">TikTok Business Catalog</span>
                </div>
            </div>
            <span class="channel-badge badge-pending" id="chan-badge-tt">Pendiente</span>
        </div>
        <div class="channel-row" id="chan-wa">
            <div class="channel-left">
                <div class="channel-icon-circle" style="background-color: #25d366;"><i class="fa-brands fa-whatsapp"></i></div>
                <div class="channel-details">
                    <span class="channel-name-txt">WhatsApp Catalog</span>
                    <span class="channel-status-msg" id="chan-msg-wa">WhatsApp Business Catalog</span>
                </div>
            </div>
            <span class="channel-badge badge-pending" id="chan-badge-wa">Pendiente</span>
        </div>
    `;
    
    // Clean and hide console logs initially
    const consoleLog = document.getElementById('sync-console-log-container');
    consoleLog.innerHTML = '';
    consoleLog.style.display = 'none';
    
    showModal('edit-product-modal');
    
    // 3. Real-time Mercado Libre details fetching (async in background)
    if (isLinkedToMl && product.codigo) {
        consoleLog.innerHTML = `<p>[System] Consultando especificaciones en tiempo real desde Mercado Libre para SKU: ${product.codigo}...</p>`;
        consoleLog.style.display = 'block';
        
        fetchApi(`/${activeTenant}/inventario/ml-details/${encodeURIComponent(product.codigo)}`)
            .then(res => {
                if (res && res.found) {
                    const logLine = document.createElement('p');
                    logLine.className = 'success-log';
                    logLine.innerHTML = `[+] Mercado Libre: Datos de publicación ${res.itemId} cargados en tiempo real.`;
                    consoleLog.appendChild(logLine);
                    consoleLog.scrollTop = consoleLog.scrollHeight;
                    
                    // Rellenar sólo si están vacíos a nivel local, para no sobreescribir cambios sin guardar
                    const fields = ['marca', 'modelo', 'numero_pieza', 'gtin', 'condicion', 'warranty_type', 'warranty_time', 'imagen_url', 'imagenes_adicionales', 'descripcion_detallada'];
                    fields.forEach(f => {
                        const el = document.getElementById(`ep-${f}`);
                        if (el && (!el.value || el.value === 'new' || el.value === 'seller_warranty')) {
                            if (res[f]) {
                                el.value = res[f];
                                if (f === 'imagen_url') {
                                    document.getElementById('ep-image-preview').src = res[f];
                                }
                            }
                        }
                    });
                } else {
                    consoleLog.innerHTML += `<p>[-] Mercado Libre: No se encontraron datos adicionales en la publicación vinculada.</p>`;
                }
            })
            .catch(err => {
                consoleLog.innerHTML += `<p class="warn-log">[!] Error al conectar con Mercado Libre API: ${err.message}</p>`;
            });
    }
}

window.toggleAiImageHelper = function() {
    const helper = document.getElementById('ai-image-helper-section');
    if (helper.style.display === 'none') {
        helper.style.display = 'flex';
        document.getElementById('ai-img-prompt').focus();
    } else {
        helper.style.display = 'none';
    }
};

window.generateAiImages = function() {
    const prompt = document.getElementById('ai-img-prompt').value.trim();
    if (!prompt) {
        alert("Por favor escriba una descripción para que la IA genere las imágenes.");
        return;
    }
    
    const resultsContainer = document.getElementById('ai-img-results');
    resultsContainer.innerHTML = `
        <div style="grid-column: 1 / span 3; text-align: center; padding: 15px; color: #4f46e5;">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 20px;"></i>
            <p style="font-size: 11px; margin-top: 5px;">Generando variaciones de imágenes con IA...</p>
        </div>
    `;
    
    // Simulate generation delay (DALL-E style) for 1.5 seconds, then return Pollinations AI endpoints
    setTimeout(() => {
        resultsContainer.innerHTML = '';
        
        const cleanPrompt = encodeURIComponent(prompt);
        const seeds = [
            Math.floor(Math.random() * 100000),
            Math.floor(Math.random() * 100000) + 100000,
            Math.floor(Math.random() * 100000) + 200000
        ];
        
        const variations = [
            {
                title: "Estudio (Fondo Blanco)",
                url: `https://image.pollinations.ai/p/${cleanPrompt},%20commercial%20product%20photography,%20studio%20lighting,%20clean%20white%20background,%20highly%20detailed,%20sharp%20focus?width=500&height=500&nologo=true&seed=${seeds[0]}`
            },
            {
                title: "Catálogo 3D",
                url: `https://image.pollinations.ai/p/${cleanPrompt},%203d%20render%20style,%20product%20catalog%20shot,%20ambient%20occlusion,%20sleek%20background?width=500&height=500&nologo=true&seed=${seeds[1]}`
            },
            {
                title: "Foto Taller Realista",
                url: `https://image.pollinations.ai/p/${cleanPrompt},%20realistic%20photo,%20placed%20in%20an%20automotive%20workshop,%20depth%20of%20field,%20professional%20lighting?width=500&height=500&nologo=true&seed=${seeds[2]}`
            }
        ];
        
        variations.forEach((item, index) => {
            const card = document.createElement('div');
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '6px';
            card.style.border = '1px solid var(--border)';
            card.style.borderRadius = '4px';
            card.style.padding = '6px';
            card.style.backgroundColor = '#ffffff';
            card.style.alignItems = 'center';
            
            card.innerHTML = `
                <span style="font-size: 9px; font-weight: 700; color: #4f46e5;">${item.title}</span>
                <img src="${item.url}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd;" onclick="zoomImage('${item.url}')" title="Clic para ampliar" />
                <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                    <button type="button" class="btn" onclick="selectAiImage('${item.url}', 'primary')" style="padding: 4px; font-size: 9px; background-color: #4f46e5; color: white; border: none; font-weight: bold; border-radius: 2px; cursor: pointer; text-align: center; width: 100%;">
                        Usar Principal
                    </button>
                    <button type="button" class="btn" onclick="selectAiImage('${item.url}', 'gallery')" style="padding: 4px; font-size: 9px; background-color: #10b981; color: white; border: none; font-weight: bold; border-radius: 2px; cursor: pointer; text-align: center; width: 100%;">
                        Añadir Galería
                    </button>
                </div>
            `;
            resultsContainer.appendChild(card);
        });
    }, 1500);
};

window.selectAiImage = function(url, target) {
    if (target === 'primary') {
        document.getElementById('ep-imagen-url').value = url;
        document.getElementById('ep-image-preview').src = url;
        alert("Imagen seleccionada como Foto Principal. ¡La vista previa se ha actualizado!");
    } else {
        const textEl = document.getElementById('ep-imagenes-adicionales');
        const currentUrls = textEl.value.trim();
        if (currentUrls) {
            textEl.value = currentUrls + ", " + url;
        } else {
            textEl.value = url;
        }
        alert("Imagen añadida a la Galería de Imágenes Adicionales.");
    }
};

window.submitEditProduct = async function(event) {
    event.preventDefault();
    if (!currentEditProduct) return;
    
    const sku = document.getElementById('ep-codigo').value;
    const desc = document.getElementById('ep-descripcion').value;
    const marca = document.getElementById('ep-marca').value;
    const modelo = document.getElementById('ep-modelo').value;
    const numeroPieza = document.getElementById('ep-numero-pieza').value;
    const gtin = document.getElementById('ep-gtin').value;
    const condicion = document.getElementById('ep-condicion').value;
    const compat = document.getElementById('ep-compatibilidad').value;
    const stock = parseFloat(document.getElementById('ep-stock').value);
    const stockMin = parseFloat(document.getElementById('ep-stock-min').value);
    const price = parseFloat(document.getElementById('ep-precio').value);
    const cost = parseFloat(document.getElementById('ep-costo').value);
    const iva = parseFloat(document.getElementById('ep-iva').value);
    const image = document.getElementById('ep-imagen-url').value;
    const imagenesAdicionales = document.getElementById('ep-imagenes-adicionales').value;
    const descripcionDetallada = document.getElementById('ep-descripcion-detallada').value;
    const warrantyType = document.getElementById('ep-warranty-type').value;
    const warrantyTime = document.getElementById('ep-warranty-time').value;
    const active = document.getElementById('ep-activo').value === "1";
    
    const body = {
        codigo: sku,
        descripcion: desc,
        marca: marca,
        modelo: modelo,
        numero_pieza: numeroPieza,
        gtin: gtin,
        condicion: condicion,
        compatibilidad: compat,
        stock_actual: stock,
        stock_minimo: stockMin,
        precio_venta: price,
        costo: cost,
        iva_tarifa: iva,
        imagen_url: image,
        imagenes_adicionales: imagenesAdicionales,
        descripcion_detallada: descripcionDetallada,
        warranty_type: warrantyType,
        warranty_time: warrantyTime,
        activo: active,
        usuario: currentUserId || 'admin'
    };
    
    // Show console log container and start terminal sync animations
    const consoleLog = document.getElementById('sync-console-log-container');
    consoleLog.innerHTML = `<p>[System] Iniciando sincronización omnicanal para SKU: ${sku}...</p>`;
    consoleLog.style.display = 'block';
    
    // Set badges to "sincronizando..."
    const channelIds = ['local', 'ml', 'wp', 'fb', 'ig', 'tt', 'wa'];
    channelIds.forEach(id => {
        const badge = document.getElementById(`chan-badge-${id}`);
        if (badge && !badge.classList.contains('badge-skipped')) {
            badge.className = 'channel-badge badge-syncing';
            badge.innerText = 'Sincronizando...';
        }
    });
    
    try {
        const res = await fetchApi(`/${activeTenant}/inventario`, {
            method: 'POST',
            body: body
        });
        
        if (res.success) {
            // Sequential delay simulation for premium micro-interaction visual feel
            for (const ch of res.channels) {
                let idPart = '';
                if (ch.name.includes('SQLite')) idPart = 'local';
                else if (ch.name.includes('Mercado')) idPart = 'ml';
                else if (ch.name.includes('WordPress')) idPart = 'wp';
                else if (ch.name.includes('Facebook')) idPart = 'fb';
                else if (ch.name.includes('Instagram')) idPart = 'ig';
                else if (ch.name.includes('TikTok')) idPart = 'tt';
                else if (ch.name.includes('WhatsApp')) idPart = 'wa';
                
                if (idPart) {
                    const badge = document.getElementById(`chan-badge-${idPart}`);
                    const msg = document.getElementById(`chan-msg-${idPart}`);
                    
                    if (badge) {
                        badge.className = `channel-badge badge-${ch.status}`;
                        badge.innerText = ch.status === 'success' ? 'Sincronizado' : (ch.status === 'skipped' ? 'Omitido' : 'Error');
                    }
                    if (msg) {
                        msg.innerText = ch.message;
                    }
                    
                    // Append log line
                    const logLine = document.createElement('p');
                    if (ch.status === 'success') {
                        logLine.className = 'success-log';
                        logLine.innerHTML = `[+] ${ch.name}: ${ch.message}`;
                    } else if (ch.status === 'skipped') {
                        logLine.innerHTML = `[-] ${ch.name}: ${ch.message}`;
                    } else {
                        logLine.className = 'warn-log';
                        logLine.innerHTML = `[!] ${ch.name}: ${ch.message}`;
                    }
                    consoleLog.appendChild(logLine);
                    consoleLog.scrollTop = consoleLog.scrollHeight;
                }
                
                // 150ms visual delay between updates
                await new Promise(r => setTimeout(r, 150));
            }
            
            const endLog = document.createElement('p');
            endLog.className = 'success-log';
            endLog.style.fontWeight = 'bold';
            endLog.innerHTML = `[✓] Sincronización completada con éxito. Catálogos actualizados.`;
            consoleLog.appendChild(endLog);
            consoleLog.scrollTop = consoleLog.scrollHeight;
            
            if (res.warning) {
                alert(res.warning);
            }
            
            // Reload inventory
            setTimeout(() => {
                closeModal('edit-product-modal');
                loadInventario(currentInventarioPage, inventarioSearchQuery);
            }, 1000);
            
        } else {
            alert('Error al guardar: ' + (res.error || 'Desconocido'));
        }
    } catch(err) {
        consoleLog.innerHTML += `<p class="warn-log">[Error] Falló la petición: ${err.message}</p>`;
        alert('Error: ' + err.message);
    }
}

async function viewProductKardex(id) {
    try {
        const data = await fetchApi(`/${activeTenant}/inventario/${id}/kardex`);
        const product = data.product;
        const movements = data.movements;
        
        // 1. Populate product info card
        const fallbackUrl = getFallbackImageUrl();
        
        const imgEl = document.getElementById('kardex-product-img');
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = fallbackUrl;
        };
        imgEl.src = product.imagen_url || fallbackUrl;
        document.getElementById('kardex-product-title').innerText = product.descripcion;
        document.getElementById('kardex-product-sku-badge').innerText = `SKU: ${product.codigo}`;
        
        document.getElementById('kardex-product-brand').innerText = product.marca || 'N/A';
        document.getElementById('kardex-product-compat').innerText = product.compatibilidad || 'N/A';
        document.getElementById('kardex-product-price').innerText = formatMoney(product.precio_venta);
        document.getElementById('kardex-product-iva').innerText = `${product.iva_tarifa < 1 ? Math.round(product.iva_tarifa * 100) : product.iva_tarifa}%`;
        document.getElementById('kardex-product-stock').innerText = product.stock_actual;
        
        const isCritical = product.activo && product.stock_actual <= product.stock_minimo;
        const alertSpan = document.getElementById('kardex-product-stock-alert');
        if (isCritical) {
            alertSpan.innerHTML = '<span class="badge badge-alert" style="font-size: 11px; padding: 2px 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Bajo</span>';
        } else {
            alertSpan.innerHTML = '<span class="badge badge-success" style="font-size: 11px; padding: 2px 6px;">OK</span>';
        }
        
        // Hide/show tenant specific details
        const isImportadora = activeTenant === 'importadora';
        document.querySelectorAll('#product-kardex-modal .importadora-only').forEach(el => {
            el.style.display = isImportadora ? 'block' : 'none';
        });

        // 2. Compute Kardex Forwards from Initial Balance (calculated backwards)
        let currentQty = product.stock_actual;
        let currentVal = product.stock_actual * (product.costo || 0);

        for (let i = movements.length - 1; i >= 0; i--) {
            const m = movements[i];
            const isEntrada = m.debito > 0 || (m.credito === 0 && m.tipo_documento !== 'FV');
            if (isEntrada) { // Entrada
                currentQty -= (m.cantidad || 0);
                currentVal -= (m.debito || 0);
            } else { // Salida
                currentQty += (m.cantidad || 0);
                currentVal += (m.credito || 0);
            }
        }

        const initialAvgCost = currentQty > 0 ? Math.max(0, currentVal / currentQty) : Math.max(0, product.costo || 0);
        
        const tbody = document.getElementById('kardex-table-body');
        tbody.innerHTML = '';
        
        // Initial Balance Row
        if (currentQty > 0 || currentVal > 0 || movements.length === 0) {
            const tr = document.createElement('tr');
            tr.style.backgroundColor = 'var(--table-header)';
            tr.innerHTML = `
                <td style="padding: 8px 10px; color: var(--text-muted);">Saldo Inicial</td>
                <td style="padding: 8px 10px; color: var(--text-muted); font-style: italic;">-</td>
                <td style="padding: 8px 10px; color: var(--text-muted);">Inventario Inicial / Ajuste Base</td>
                <td style="padding: 8px 10px; text-align: center; color: var(--text-muted);">-</td>
                <td style="padding: 8px 10px; text-align: center; color: var(--text-muted);">-</td>
                <td style="padding: 8px 10px; text-align: center; font-weight: 700; border-left: 1px solid var(--border);">${currentQty}</td>
                <td style="padding: 8px 10px; text-align: right; font-weight: 600;">${formatMoney(initialAvgCost)}</td>
            `;
            tbody.appendChild(tr);
        }
        
        let runningQty = currentQty;
        let runningAvgCost = initialAvgCost;
        let runningVal = runningQty * runningAvgCost;
        
        movements.forEach(m => {
            let entradaStr = '-';
            let salidaStr = '-';
            
            const isEntrada = m.debito > 0 || (m.credito === 0 && m.tipo_documento !== 'FV');
            if (isEntrada) { // Entrada
                const qty = m.cantidad || 0;
                const cost = m.precio_unitario || 0;
                runningQty += qty;
                runningVal += m.debito;
                runningAvgCost = runningQty > 0 ? (runningVal / runningQty) : 0;
                entradaStr = `<strong>${qty}</strong> x ${formatMoney(cost)}`;
            } else { // Salida
                const qty = m.cantidad || 0;
                const cost = m.precio_unitario || 0;
                runningQty -= qty;
                runningVal -= m.credito;
                salidaStr = `<strong>${qty}</strong> x ${formatMoney(cost)}`;
            }
            
            const docLabel = `${m.tipo_documento} ${m.prefijo ? m.prefijo + '-' : ''}${m.numero}`;
            const docLinkHtml = `<a href="#" onclick="closeModal('product-kardex-modal'); setTimeout(() => viewAsientoDetails(${m.asiento_id}), 150); return false;" style="font-weight: 600; color: var(--primary); text-decoration: underline;">${docLabel}</a>`;
            const thirdPartyStr = m.tercero_nombre ? `${m.tercero_nombre} (${m.tercero_nit})` : 'N/A';
            const conceptStr = `<div style="font-weight: 500;">${m.concepto_linea || m.concepto}</div><div style="font-size:10px; color:var(--text-muted);">${thirdPartyStr}</div>`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 8px 10px;">${m.fecha}</td>
                <td style="padding: 8px 10px;">${docLinkHtml}</td>
                <td style="padding: 8px 10px;">${conceptStr}</td>
                <td style="padding: 8px 10px; text-align: center; background-color: rgba(34, 197, 94, 0.02);">${entradaStr}</td>
                <td style="padding: 8px 10px; text-align: center; background-color: rgba(239, 68, 68, 0.02);">${salidaStr}</td>
                <td style="padding: 8px 10px; text-align: center; font-weight: 700; border-left: 1px solid var(--border);">${runningQty}</td>
                <td style="padding: 8px 10px; text-align: right; font-weight: 600; color: #16a34a;">${formatMoney(runningAvgCost)}</td>
            `;
            tbody.appendChild(tr);
        });
        
        document.getElementById('kardex-product-avg-cost').innerText = formatMoney(runningAvgCost);
        
        // 3. Fetch Mercado Libre publications status
        const mlSection = document.getElementById('kardex-ml-section');
        const mlList = document.getElementById('kardex-ml-list');
        mlSection.style.display = 'none'; // reset
        mlList.innerHTML = '';

        if (activeTenant === 'importadora') {
            mlSection.style.display = 'block'; // Always show section for Importadora so user sees the feature is there
            try {
                const mlData = await fetchApi(`/${activeTenant}/mercadolibre/product-status?sku=${encodeURIComponent(product.codigo)}`);
                if (mlData && mlData.publications && mlData.publications.length > 0) {
                    mlData.publications.forEach(pub => {
                        let badgeColor = '#10b981'; // Green for active
                        let statusText = 'Activa 🟢';
                        let actionButtonsHtml = '';

                        if (pub.status === 'paused') {
                            badgeColor = '#f59e0b';
                            statusText = 'Pausada 🟡';
                            actionButtonsHtml = `
                                <div style="display:flex; gap:4px; margin-top:4px;">
                                    <button class="btn btn-secondary" style="font-size:11px; padding:3px 6px;" onclick="updateMlItemStatus('${pub.id}', ${pub.account_id}, 'reactivate')">
                                        <i class="fa-solid fa-play"></i> Reactivar
                                    </button>
                                    <button class="btn btn-secondary" style="font-size:11px; padding:3px 6px; color:#ef4444;" onclick="updateMlItemStatus('${pub.id}', ${pub.account_id}, 'delete')">
                                        <i class="fa-solid fa-trash-can"></i> Eliminar
                                    </button>
                                </div>
                            `;
                        } else if (pub.status === 'deleted') {
                            badgeColor = '#ef4444';
                            statusText = 'Eliminada 🔴';
                            actionButtonsHtml = `<div style="font-size:11px; color:var(--text-muted); font-style:italic; margin-top:2px;">Eliminada de Mercado Libre</div>`;
                        } else {
                            // Active status
                            actionButtonsHtml = `
                                <div style="display:flex; gap:4px; margin-top:4px;">
                                    <button class="btn btn-secondary" style="font-size:11px; padding:3px 6px;" onclick="updateMlItemStatus('${pub.id}', ${pub.account_id}, 'pause')">
                                        <i class="fa-solid fa-pause"></i> Pausar
                                    </button>
                                    <button class="btn btn-secondary" style="font-size:11px; padding:3px 6px; color:#ef4444;" onclick="updateMlItemStatus('${pub.id}', ${pub.account_id}, 'delete')">
                                        <i class="fa-solid fa-trash-can"></i> Eliminar
                                    </button>
                                </div>
                            `;
                        }

                        // Find account name if available
                        const accountName = pub.accountName || (mlData.accounts && mlData.accounts.find(a => a.id === pub.account_id) || { account_name: 'Cuenta ML' }).account_name;

                        const itemDiv = document.createElement('div');
                        itemDiv.style.border = '1px solid var(--border)';
                        itemDiv.style.borderRadius = '6px';
                        itemDiv.style.padding = '8px';
                        itemDiv.style.backgroundColor = 'var(--bg-card)';
                        itemDiv.innerHTML = `
                            <div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; font-size:11px; margin-bottom:2px;">
                                <span style="font-family:monospace; color:var(--primary);">${pub.id}</span>
                                <span style="color:${badgeColor}; font-size:10px; font-weight:700;">${statusText}</span>
                            </div>
                            <div style="font-size:11px; font-weight:500; margin-bottom:2px; line-height:1.2; word-break:break-word;">${pub.title}</div>
                            <div style="font-size:10px; color:var(--text-muted);">
                                <strong>Cuenta:</strong> ${accountName} | <strong>Precio:</strong> ${formatMoney(pub.price)}
                            </div>
                            ${actionButtonsHtml}
                        `;
                        mlList.appendChild(itemDiv);
                    });
                } else {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.style.fontSize = '12px';
                    emptyDiv.style.color = 'var(--text-muted)';
                    emptyDiv.style.fontStyle = 'italic';
                    emptyDiv.style.padding = '4px 0';
                    emptyDiv.innerText = 'Sin publicaciones vinculadas para este SKU';
                    mlList.appendChild(emptyDiv);
                }
            } catch (err) {
                console.warn('Failed to load Mercado Libre product status:', err);
                const errorDiv = document.createElement('div');
                errorDiv.style.fontSize = '12px';
                errorDiv.style.color = '#ef4444';
                errorDiv.innerText = 'Error al cargar vinculaciones';
                mlList.appendChild(errorDiv);
            }
        }

        showModal('product-kardex-modal');
    } catch (e) {
        alert('Error al cargar historial Kardex: ' + e.message);
    }
}

async function updateMlItemStatus(itemId, accountId, action) {
    let endpoint = '';
    if (action === 'pause') endpoint = 'pause-item';
    else if (action === 'reactivate') endpoint = 'reactivate-item';
    else if (action === 'delete') endpoint = 'delete-item';

    if (!endpoint) return;

    // Ask for user confirmation before deleting
    if (action === 'delete') {
        const confirmDelete = confirm('¿Estás seguro de que deseas eliminar permanentemente esta publicación de Mercado Libre?');
        if (!confirmDelete) return;
    }

    try {
        const res = await fetchApi(`/${activeTenant}/mercadolibre/${endpoint}`, {
            method: 'POST',
            body: JSON.stringify({
                itemId,
                accountId,
                usuario: currentUserId
            })
        });

        alert(res.message || 'Acción completada con éxito');
        
        // Refresh product details in Kardex modal
        const productIdMatch = document.getElementById('kardex-product-sku-badge').innerText.match(/SKU:\s*(.+)/);
        if (productIdMatch) {
            const sku = productIdMatch[1].trim();
            const product = cacheInventario.find(p => p.codigo === sku);
            if (product) {
                await viewProductKardex(product.id);
            }
        }

        // Refresh general inventory table data in the background
        loadCurrentTenantData();
    } catch (e) {
        alert('Error al realizar acción en Mercado Libre: ' + e.message);
    }
}

async function linkMlItemToProduct() {
    const input = document.getElementById('kardex-ml-link-id');
    const itemId = (input.value || '').trim();
    if (!itemId) {
        alert('Por favor ingrese un ID de publicación de Mercado Libre válido (ej. MCO-123456789)');
        return;
    }
    
    // Check format (MCO- followed by numbers)
    if (!/^MCO-\d+$/i.test(itemId)) {
        alert('Formato de publicación inválido. Debe iniciar con MCO- y contener el número de la publicación (ej. MCO-123456789)');
        return;
    }

    // Get current product SKU from the modal's badge
    const badgeText = document.getElementById('kardex-product-sku-badge').innerText;
    const sku = badgeText.replace('SKU:', '').trim();

    if (!sku) {
        alert('El producto debe tener un SKU local asignado para poder vincularse con Mercado Libre.');
        return;
    }

    const btn = document.getElementById('kardex-ml-btn-link');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const result = await fetchApi(`/${activeTenant}/mercadolibre/link-item`, {
            method: 'POST',
            body: {
                itemId: itemId.toUpperCase(),
                sku: sku,
                usuario: currentUserId
            }
        });

        if (result.success) {
            alert('¡Publicación vinculada con éxito!');
            input.value = '';
            
            // Reload the Kardex modal views to see the linked publication immediately!
            const matchedProd = cacheInventario.find(p => p.codigo === sku);
            if (matchedProd) {
                await viewProductKardex(matchedProd.id);
            } else {
                location.reload();
            }
            // Refresh general inventory table data in the background
            loadCurrentTenantData();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (e) {
        alert('Error al vincular: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// --- MODULE: FACTURACION DIAN (Importadora) ---
function prepareFacturacionView() {
    invoiceItems = [];
    renderInvoiceItems();
    
    // Clear autocomplete fields
    const searchCliente = document.getElementById('fac-cliente-search');
    if (searchCliente) searchCliente.value = '';
    const hiddenCliente = document.getElementById('fac-cliente');
    if (hiddenCliente) hiddenCliente.value = '';

    const searchProduct = document.getElementById('fac-product-search');
    if (searchProduct) searchProduct.value = '';
    const hiddenProduct = document.getElementById('fac-add-product');
    if (hiddenProduct) hiddenProduct.value = '';
    
    if (cacheInventario.length > 0) {
        document.getElementById('fac-add-price').value = cacheInventario[0].precio_venta;
    } else {
        document.getElementById('fac-add-price').value = 0;
    }

    // Reset discount program fields
    const hasDiscount = document.getElementById('fac-has-discount');
    if (hasDiscount) hasDiscount.checked = false;
    const discountFields = document.getElementById('fac-discount-fields');
    if (discountFields) discountFields.style.display = 'none';
    const discountPct = document.getElementById('fac-discount-pct');
    if (discountPct) discountPct.value = '';
    const discountFixed = document.getElementById('fac-discount-fixed');
    if (discountFixed) discountFixed.value = '';
    const targetTotal = document.getElementById('fac-target-total');
    if (targetTotal) targetTotal.value = '';
    facDiscountMode = 'pct';
    facDiscountVal = 0;

    updateInvoiceTotals();
}

function addInvoiceItemRow() {
    const selectProd = document.getElementById('fac-add-product');
    const productId = parseInt(selectProd.value);
    const qty = parseFloat(document.getElementById('fac-add-qty').value) || 1;
    const grossPrice = parseFloat(document.getElementById('fac-add-price').value) || 0;
    
    const product = findProductById(productId);
    if (!product) return;

    const netPrice = grossPrice / 1.19;
    const itemSubtotal = qty * netPrice;

    // Check if product already added
    const existing = invoiceItems.find(item => item.product.id === productId);
    if (existing) {
        existing.cantidad += qty;
        existing.precio = netPrice;
        existing.subtotal = existing.cantidad * netPrice;
    } else {
        invoiceItems.push({
            product,
            cantidad: qty,
            precio: netPrice,
            subtotal: itemSubtotal
        });
    }

    renderInvoiceItems();
    updateInvoiceTotals();
    clearProductSearchFields('fac');
}

function removeInvoiceItemRow(idx) {
    invoiceItems.splice(idx, 1);
    renderInvoiceItems();
    updateInvoiceTotals();
}

function renderInvoiceItems() {
    const tbody = document.querySelector('#invoice-items-table tbody');
    tbody.innerHTML = '';
    
    invoiceItems.forEach((item, idx) => {
        const tr = document.createElement('tr');
        const imgHtml = item.product.imagen_url 
            ? `<img src="${item.product.imagen_url}" style="width:24px; height:24px; object-fit:cover; border-radius:4px; margin-right:8px; vertical-align:middle; border:1px solid var(--border-color);"/>` 
            : `<div style="width:24px; height:24px; border-radius:4px; margin-right:8px; vertical-align:middle; background:var(--background-secondary); border:1px dashed var(--border-color); display:inline-flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:10px;"><i class="fa-solid fa-image"></i></div>`;
        tr.innerHTML = `
            <td style="cursor: pointer; text-decoration: underline; color: var(--accent); font-weight: 600;" onclick="viewProductImage('${item.product.imagen_url || ''}')">${item.product.codigo}</td>
            <td><div style="display:flex; align-items:center;">${imgHtml}<span>${item.product.descripcion}</span></div></td>
            <td>${item.cantidad}</td>
            <td>${formatMoney(item.precio)}</td>
            <td>${formatMoney(item.subtotal)}</td>
            <td><button type="button" class="btn btn-secondary" onclick="removeInvoiceItemRow(${idx})"><i class="fa-solid fa-trash"></i></button></td>
        `;
        tbody.appendChild(tr);
    });
}

let facDiscountMode = 'pct';
let facDiscountVal = 0;

function toggleDiscountFields() {
    const hasDiscount = document.getElementById('fac-has-discount').checked;
    const fields = document.getElementById('fac-discount-fields');
    if (fields) {
        fields.style.display = hasDiscount ? 'flex' : 'none';
    }
    if (!hasDiscount) {
        document.getElementById('fac-discount-pct').value = '';
        document.getElementById('fac-target-total').value = '';
        document.getElementById('fac-discount-fixed').value = '';
        facDiscountMode = 'pct';
        facDiscountVal = 0;
    }
    updateInvoiceTotals();
}

function applyDiscountByPct() {
    facDiscountMode = 'pct';
    document.getElementById('fac-target-total').value = '';
    document.getElementById('fac-discount-fixed').value = '';
    updateInvoiceTotals();
}

function applyDiscountByFixed() {
    facDiscountMode = 'fixed';
    document.getElementById('fac-discount-pct').value = '';
    document.getElementById('fac-target-total').value = '';
    updateInvoiceTotals();
}

function applyDiscountByTargetTotal() {
    facDiscountMode = 'target';
    document.getElementById('fac-discount-pct').value = '';
    document.getElementById('fac-discount-fixed').value = '';
    updateInvoiceTotals();
}

function updateInvoiceTotals() {
    let subtotal = 0;
    
    invoiceItems.forEach(item => {
        subtotal += item.subtotal;
    });

    const isReteFte = false;
    const isReteIca = false;
    const hasDiscount = document.getElementById('fac-has-discount') ? document.getElementById('fac-has-discount').checked : false;
    
    const clienteId = parseInt(document.getElementById('fac-cliente').value);
    const client = cacheTerceros.find(t => t.id === clienteId);
    
    let rateIca = 0;

    let discountVal = 0;
    
    if (hasDiscount && subtotal > 0) {
        const pctInput = document.getElementById('fac-discount-pct');
        const targetInput = document.getElementById('fac-target-total');
        const fixedInput = document.getElementById('fac-discount-fixed');
        
        if (facDiscountMode === 'pct') {
            const pct = parseFloat(pctInput.value) || 0;
            discountVal = Math.round(subtotal * (pct / 100));
            if (discountVal > subtotal) discountVal = subtotal;
            if (discountVal < 0) discountVal = 0;
        } else if (facDiscountMode === 'target') {
            const targetTotal = parseFloat(targetInput.value);
            if (!isNaN(targetTotal) && targetTotal >= 0) {
                let S_net = targetTotal / 1.19;
                
                S_net = Math.round(S_net);
                if (S_net > subtotal) S_net = subtotal;
                if (S_net < 0) S_net = 0;
                
                discountVal = subtotal - S_net;
                
                const pct = (discountVal / subtotal) * 100;
                pctInput.value = pct.toFixed(2);
            }
        } else if (facDiscountMode === 'fixed') {
            const fixedVal = parseFloat(fixedInput.value);
            if (!isNaN(fixedVal) && fixedVal >= 0) {
                let d_net = fixedVal / 1.19;
                d_net = Math.round(d_net);
                if (d_net > subtotal) d_net = subtotal;
                if (d_net < 0) d_net = 0;
                
                discountVal = d_net;
                
                const pct = (discountVal / subtotal) * 100;
                pctInput.value = pct.toFixed(2);
            }
        }
    }

    facDiscountVal = discountVal;
    const subtotalNeto = subtotal - discountVal;
    const iva = Math.round(subtotalNeto * 0.19);
    
    let retefte = 0;
    let reteica = 0;

    const total = subtotalNeto + iva;

    // Synchronize other input fields
    if (hasDiscount && subtotal > 0) {
        const targetInput = document.getElementById('fac-target-total');
        const fixedInput = document.getElementById('fac-discount-fixed');
        
        if (facDiscountMode === 'pct') {
            if (targetInput) targetInput.value = Math.round(total);
            if (fixedInput) fixedInput.value = Math.round(discountVal * 1.19);
        } else if (facDiscountMode === 'target') {
            if (fixedInput) fixedInput.value = Math.round(discountVal * 1.19);
        } else if (facDiscountMode === 'fixed') {
            if (targetInput) targetInput.value = Math.round(total);
        }
    }

    document.getElementById('tot-subtotal').innerText = formatMoney(subtotal);
    
    const discountRow = document.getElementById('tot-row-discount');
    if (discountRow) {
        if (discountVal > 0) {
            discountRow.style.display = 'flex';
            document.getElementById('tot-discount').innerText = '-' + formatMoney(discountVal);
        } else {
            discountRow.style.display = 'none';
        }
    }
    
    document.getElementById('tot-iva').innerText = formatMoney(iva);
    document.getElementById('tot-retefte').innerText = formatMoney(retefte);
    document.getElementById('tot-reteica').innerText = formatMoney(reteica);
    document.getElementById('tot-neto').innerText = formatMoney(total);

    // Update big cashier display card
    const cashierSubtotal = document.getElementById('cashier-subtotal');
    if (cashierSubtotal) cashierSubtotal.innerText = formatMoney(subtotal);

    const cashierRowDiscount = document.getElementById('cashier-row-discount');
    const cashierDiscount = document.getElementById('cashier-discount');
    const cashierRowNet = document.getElementById('cashier-row-net');
    const cashierNetSubtotal = document.getElementById('cashier-net-subtotal');

    if (cashierRowDiscount) cashierRowDiscount.style.display = 'flex';
    if (cashierDiscount) {
        cashierDiscount.innerText = discountVal > 0 ? '-' + formatMoney(discountVal) : formatMoney(0);
    }
    if (cashierRowNet) cashierRowNet.style.display = 'flex';
    if (cashierNetSubtotal) cashierNetSubtotal.innerText = formatMoney(subtotalNeto);

    const cashierIva = document.getElementById('cashier-iva');
    if (cashierIva) cashierIva.innerText = formatMoney(iva);

    const cashierTotal = document.getElementById('cashier-total');
    if (cashierTotal) cashierTotal.innerText = formatMoney(total);

    // Dynamic Causación Preview in World Office style
    renderCausacionPreview(subtotal, iva, retefte, reteica, total, client, discountVal);
}

// Add triggers for retenciones changes to recalculate totals
if (document.getElementById('fac-retefte')) {
    document.getElementById('fac-retefte').addEventListener('change', updateInvoiceTotals);
}
if (document.getElementById('fac-reteica')) {
    document.getElementById('fac-reteica').addEventListener('change', updateInvoiceTotals);
}
if (document.getElementById('fac-cliente')) {
    document.getElementById('fac-cliente').addEventListener('change', updateInvoiceTotals);
}
if (document.getElementById('fac-pago')) {
    document.getElementById('fac-pago').addEventListener('change', updateInvoiceTotals);
}

function renderCausacionPreview(subtotal, iva, retefte, reteica, total, client, discountVal = 0) {
    const box = document.getElementById('causacion-preview-lines');
    box.innerHTML = '';
    
    if (subtotal === 0) {
        box.innerHTML = '<span class="placeholder-text">Agrega productos para previsualizar causación</span>';
        return;
    }

    const clientName = client ? client.nombre : 'CLIENTE';
    const lines = [];

    // Credit to Revenue (413501)
    lines.push({ cuenta: '413501 (Comercio Venta)', desc: 'Ingreso Comercial', debito: 0, credito: subtotal });
    
    // Debit to Discount (4175)
    if (discountVal > 0) {
        lines.push({ cuenta: '4175 (Descuento Venta)', desc: 'Descuento Comercial Concedido', debito: discountVal, credito: 0 });
    }

    // Credit to IVA (2408)
    if (iva > 0) {
        lines.push({ cuenta: '2408 (IVA por Pagar)', desc: 'IVA Generado', debito: 0, credito: iva });
    }
    // Debit to Retentions (1355)
    if (retefte > 0) {
        lines.push({ cuenta: '135515 (Retención Fte)', desc: `ReteFte 2.5% ${clientName}`, debito: retefte, credito: 0 });
    }
    if (reteica > 0) {
        lines.push({ cuenta: '135518 (ReteICA)', desc: `ReteICA ${clientName}`, debito: reteica, credito: 0 });
    }
    // Debit to Cash/Bancos or Cartera (130505)
    const payMethod = document.getElementById('fac-pago').value;
    const payAccounts = {
        'efectivo': { c: '11050501 (Caja General)', d: 'Venta de Contado Caja' },
        'bancolombia': { c: '11100508 (Bancolombia)', d: 'Venta de Contado Bancolombia' },
        'nequi': { c: '11100510 (Nequi)', d: 'Venta de Contado Nequi' },
        'credito': { c: '13050501 (Clientes Nacionales)', d: 'Venta a Crédito 30 días' }
    };
    const payAcc = payAccounts[payMethod];
    lines.push({ cuenta: payAcc.c, desc: payAcc.d, debito: total, credito: 0 });

    lines.forEach(l => {
        const div = document.createElement('div');
        div.className = 'causacion-line';
        div.innerHTML = `
            <span><strong>${l.cuenta}</strong></span>
            <span>${l.desc}</span>
            <span style="color:var(--accent); font-weight:bold;">${l.debito > 0 ? formatMoney(l.debito) : ''}</span>
            <span style="color:var(--text-muted);">${l.credito > 0 ? formatMoney(l.credito) : ''}</span>
        `;
        box.appendChild(div);
    });
}

async function submitFactura(e, transmitir = true) {
    if (e) e.preventDefault();
    if (invoiceItems.length === 0) {
        alert('Debe agregar al menos un producto.');
        return;
    }

    const form = document.getElementById('factura-form');
    const clientNameSearch = document.getElementById('fac-cliente-search').value;
    const clientName = clientNameSearch ? clientNameSearch.split(' - ')[1] : 'CLIENTE';

    const body = {
        cliente_id: parseInt(form.elements['fac-cliente'].value),
        prefijo: form.elements['fac-prefijo'].value.trim(),
        fecha: form.elements['fac-fecha'].value,
        concepto: `Venta Comercial Factura ${form.elements['fac-prefijo'].value.trim()} - Tercero: ${clientName} - items: ${invoiceItems.map(item => `${item.product.codigo} (${item.product.descripcion})`).join(', ')}`,
        metodo_pago: form.elements['fac-pago'].value,
        retenciones: {
            retefuente: false,
            reteica: false
        },
        descuento: facDiscountVal,
        items: invoiceItems.map(item => ({
            producto_id: item.product.id,
            cantidad: item.cantidad,
            precio_unitario: item.precio
        })),
        usuario: 'admin',
        transmitir: transmitir
    };

    try {
        const result = await fetchApi(`/${activeTenant}/factura`, { method: 'POST', body });
        
        let msg = `Factura guardada y causada con éxito locally!\n`;
        msg += `Número de Asiento: FV-${result.numero}\n`;
        msg += `Total: ${formatMoney(result.total)}\n`;
        
        if (transmitir) {
            msg += `CUFE: ${result.cufe ? result.cufe.substring(0, 30) : ''}...\n\n`;
            if (result.dian && result.dian.success) {
                msg += `Respuesta DIAN: APROBADA (Código ${result.dian.status})\n`;
                msg += `Código QR generado. Documento enlazado a la DIAN.`;
            } else {
                msg += `Servidor DIAN fuera de línea. Documento guardado localmente y en cola de CONTINGENCIA para retransmisión automática.`;
            }
        } else {
            msg += `Estado: Guardado Local (No Transmitido a la DIAN).`;
        }
        
        lastCreatedInvoiceId = result.asientoId;
        const verBtn = document.getElementById('fac-btn-ver-factura');
        if (verBtn) verBtn.style.display = 'inline-block';

        alert(msg);
        prepareFacturacionView();
        loadNextDocumentNumbers();
        // Permanece en la misma pantalla para seguir facturando
    } catch (e) {
        alert('Error al facturar: ' + e.message);
    }
}

function viewLastCreatedInvoice() {
    if (lastCreatedInvoiceId) {
        viewAsientoDetails(lastCreatedInvoiceId);
    } else {
        alert("No hay ninguna factura guardada recientemente para visualizar.");
    }
}

// --- MODULE: DOCUMENTO SOPORTE (Compras) ---
function prepareComprasView() {
    purchaseItems = [];
    renderPurchaseItems();
    
    // Clear autocomplete fields
    const searchProv = document.getElementById('com-proveedor-search');
    if (searchProv) searchProv.value = '';
    const hiddenProv = document.getElementById('com-proveedor');
    if (hiddenProv) hiddenProv.value = '';

    const searchProduct = document.getElementById('com-product-search');
    if (searchProduct) searchProduct.value = '';
    const hiddenProduct = document.getElementById('com-add-product');
    if (hiddenProduct) hiddenProduct.value = '';
    
    if (cacheInventario.length > 0) {
        document.getElementById('com-add-cost').value = cacheInventario[0].costo;
    } else {
        document.getElementById('com-add-cost').value = 0;
    }

    updatePurchaseTotals();
}

function addPurchaseItemRow() {
    const selectProd = document.getElementById('com-add-product');
    const productId = parseInt(selectProd.value);
    const qty = parseFloat(document.getElementById('com-add-qty').value) || 1;
    const cost = parseFloat(document.getElementById('com-add-cost').value) || 0;
    
    const product = findProductById(productId);
    if (!product) return;

    const existing = purchaseItems.find(item => item.product.id === productId);
    if (existing) {
        existing.cantidad += qty;
        existing.subtotal = existing.cantidad * existing.costo;
    } else {
        purchaseItems.push({
            product,
            cantidad: qty,
            costo: cost,
            subtotal: qty * cost
        });
    }

    renderPurchaseItems();
    updatePurchaseTotals();
    clearProductSearchFields('com');
}

function removePurchaseItemRow(idx) {
    purchaseItems.splice(idx, 1);
    renderPurchaseItems();
    updatePurchaseTotals();
}

function renderPurchaseItems() {
    const tbody = document.querySelector('#purchase-items-table tbody');
    tbody.innerHTML = '';
    
    purchaseItems.forEach((item, idx) => {
        const tr = document.createElement('tr');
        const imgHtml = item.product.imagen_url 
            ? `<img src="${item.product.imagen_url}" style="width:24px; height:24px; object-fit:cover; border-radius:4px; margin-right:8px; vertical-align:middle; border:1px solid var(--border-color);"/>` 
            : `<div style="width:24px; height:24px; border-radius:4px; margin-right:8px; vertical-align:middle; background:var(--background-secondary); border:1px dashed var(--border-color); display:inline-flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:10px;"><i class="fa-solid fa-image"></i></div>`;
        tr.innerHTML = `
            <td>${item.product.codigo}</td>
            <td><div style="display:flex; align-items:center;">${imgHtml}<span>${item.product.descripcion}</span></div></td>
            <td>${item.cantidad}</td>
            <td>${formatMoney(item.costo)}</td>
            <td>${formatMoney(item.subtotal)}</td>
            <td><button type="button" class="btn btn-secondary" onclick="removePurchaseItemRow(${idx})"><i class="fa-solid fa-trash"></i></button></td>
        `;
        tbody.appendChild(tr);
    });
}

function updatePurchaseTotals() {
    let subtotal = 0;
    purchaseItems.forEach(item => {
        subtotal += item.subtotal;
    });

    const iva = Math.round(subtotal * 0.19);

    const isReteFte = document.getElementById('com-retefte').checked;
    let retefte = 0;
    if (isReteFte && subtotal >= 150000) {
        retefte = Math.round(subtotal * 0.025);
    }

    const total = subtotal + iva - retefte;

    document.getElementById('com-tot-subtotal').innerText = formatMoney(subtotal);
    document.getElementById('com-tot-iva').innerText = formatMoney(iva);
    document.getElementById('com-tot-retefte').innerText = formatMoney(retefte);
    document.getElementById('com-tot-neto').innerText = formatMoney(total);
    
    updatePurchaseContabilizacion();
}

function updatePurchaseContabilizacion() {
    let subtotal = 0;
    purchaseItems.forEach(item => {
        subtotal += item.subtotal;
    });

    const iva = Math.round(subtotal * 0.19);

    const isReteFte = document.getElementById('com-retefte').checked;
    let retefte = 0;
    if (isReteFte && subtotal >= 150000) {
        retefte = Math.round(subtotal * 0.025);
    }

    const total = subtotal + iva - retefte;

    const vendorId = parseInt(document.getElementById('com-proveedor').value);
    const vendor = cacheTerceros.find(t => t.id === vendorId);
    const vendorName = vendor ? vendor.nombre : 'PROVEEDOR';

    const tbody = document.querySelector('#ds-doc-accounting-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (subtotal === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Completa el formulario</td></tr>';
        return;
    }

    // 1. Debit to Inventory (143501)
    const tr1 = document.createElement('tr');
    tr1.innerHTML = `
        <td><strong>143501</strong> - INVENTARIO MERCANCÍAS</td>
        <td>${vendorName}</td>
        <td class="col-amount col-debit">${formatMoney(subtotal)}</td>
        <td class="col-amount col-credit"></td>
    `;
    tbody.appendChild(tr1);

    // 2. Debit to IVA (2408)
    if (iva > 0) {
        const trIva = document.createElement('tr');
        trIva.innerHTML = `
            <td><strong>2408</strong> - IVA DESCONTABLE (19%)</td>
            <td>${vendorName}</td>
            <td class="col-amount col-debit">${formatMoney(iva)}</td>
            <td class="col-amount col-credit"></td>
        `;
        tbody.appendChild(trIva);
    }

    // 3. Credit to ReteFuente (2365)
    if (retefte > 0) {
        const tr2 = document.createElement('tr');
        tr2.innerHTML = `
            <td><strong>2365</strong> - RETENCION EN LA FUENTE</td>
            <td>${vendorName}</td>
            <td class="col-amount col-debit"></td>
            <td class="col-amount col-credit">${formatMoney(retefte)}</td>
        `;
        tbody.appendChild(tr2);
    }

    // 4. Credit to Payment Method Account (Caja/Banco/Proveedores)
    const payMethod = document.getElementById('com-pago').value;
    let payAccountCode = '2205'; // Default Proveedores
    let payAccountName = 'PROVEEDORES NACIONALES';
    if (payMethod === 'efectivo') {
        payAccountCode = '11050501';
        payAccountName = 'CAJA GENERAL';
    } else if (payMethod === 'bancolombia') {
        payAccountCode = '11100508';
        payAccountName = 'BANCO BANCOLOMBIA';
    } else if (payMethod === 'nequi') {
        payAccountCode = '11100510';
        payAccountName = 'NEQUI';
    }

    const tr3 = document.createElement('tr');
    tr3.innerHTML = `
        <td><strong>${payAccountCode}</strong> - ${payAccountName}</td>
        <td>${vendorName}</td>
        <td class="col-amount col-debit"></td>
        <td class="col-amount col-credit">${formatMoney(total)}</td>
    `;
    tbody.appendChild(tr3);

    // Totales Sumas Iguales
    const trTot = document.createElement('tr');
    trTot.className = 'totals-row';
    trTot.innerHTML = `
        <td colspan="2">SUMAS IGUALES</td>
        <td class="col-amount col-debit">${formatMoney(subtotal)}</td>
        <td class="col-amount col-credit">${formatMoney(subtotal)}</td>
    `;
    tbody.appendChild(trTot);
}

if (document.getElementById('com-retefte')) {
    document.getElementById('com-retefte').addEventListener('change', updatePurchaseTotals);
}

async function submitCompra(e) {
    e.preventDefault();
    if (purchaseItems.length === 0) {
        alert('Debe agregar al menos un producto a la compra.');
        return;
    }

    const form = document.getElementById('compra-form');
    const body = {
        tercero_id: parseInt(form.elements['com-proveedor'].value),
        fecha: form.elements['com-fecha'].value,
        concepto: `Compra: ${form.elements['com-concepto'].value.trim()} - Tercero: ${document.getElementById('com-proveedor-search').value.split(' - ')[1]} - items: ${purchaseItems.map(item => `${item.product.codigo} (${item.product.descripcion})`).join(', ')}`,
        metodo_pago: form.elements['com-pago'].value,
        retenciones: {
            retefuente: document.getElementById('com-retefte').checked
        },
        items: purchaseItems.map(item => ({
            producto_id: item.product.id,
            cantidad: item.cantidad,
            costo_unitario: item.costo
        })),
        usuario: 'admin'
    };

    try {
        const result = await fetchApi(`/${activeTenant}/documento-soporte`, { method: 'POST', body });
        alert(`Documento Soporte guardado y causado locally con éxito!\nNúmero: DS-${result.numero}\nTotal: ${formatMoney(result.total)}`);
        prepareComprasView();
        loadNextDocumentNumbers();
        // Permanece en la misma pantalla para seguir registrando compras
    } catch (e) {
        alert('Error al registrar compra: ' + e.message);
    }
}

// --- MODULE: TAQUILLA POS RAPIDO (Club Sol del Valle) ---
function prepareTaquillaView() {
    posCart = [];
    renderPosCart();
    
    // Clear autocomplete fields
    const searchInput = document.getElementById('pos-cliente-search');
    if (searchInput) searchInput.value = '';
    const hiddenInput = document.getElementById('pos-cliente');
    if (hiddenInput) hiddenInput.value = '';

    // Populate catalog buttons
    const grid = document.getElementById('pos-buttons-grid');
    grid.innerHTML = '';
    posQuickCatalog.forEach(item => {
        const btn = document.createElement('div');
        btn.className = 'pos-item-btn';
        btn.innerHTML = `
            <i class="fa-solid ${item.icon}"></i>
            <span>${item.descripcion}</span>
            <p>${formatMoney(item.precio)}</p>
        `;
        btn.addEventListener('click', () => addPosItem(item));
        grid.appendChild(btn);
    });
}

function addPosItem(catalogItem) {
    const existing = posCart.find(item => item.id === catalogItem.id);
    if (existing) {
        existing.qty++;
    } else {
        posCart.push({
            ...catalogItem,
            qty: 1
        });
    }
    renderPosCart();
}

function changePosQty(idx, offset) {
    posCart[idx].qty += offset;
    if (posCart[idx].qty <= 0) {
        posCart.splice(idx, 1);
    }
    renderPosCart();
}

function clearPosCart() {
    posCart = [];
    renderPosCart();
}

function renderPosCart() {
    const list = document.getElementById('pos-cart-list');
    list.innerHTML = '';
    
    if (posCart.length === 0) {
        list.innerHTML = '<div class="empty-cart-message">El ticket está vacío. Haz clic en los botones de venta.</div>';
        document.getElementById('pos-subtotal-val').innerText = formatMoney(0);
        document.getElementById('pos-iva-val').innerText = formatMoney(0);
        document.getElementById('pos-total-val').innerText = formatMoney(0);
        return;
    }

    let subtotal = 0;
    posCart.forEach((item, idx) => {
        const sub = item.qty * item.precio;
        subtotal += sub;

        const row = document.createElement('div');
        row.className = 'pos-cart-row';
        row.innerHTML = `
            <div>
                <span class="pos-cart-item-name">${item.descripcion}</span>
                <div class="pos-cart-item-qty">${item.qty} x ${formatMoney(item.precio)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <strong>${formatMoney(sub)}</strong>
                <button type="button" class="btn btn-secondary" style="padding:2px 6px;" onclick="changePosQty(${idx}, 1)">+</button>
                <button type="button" class="btn btn-secondary" style="padding:2px 6px;" onclick="changePosQty(${idx}, -1)">-</button>
            </div>
        `;
        list.appendChild(row);
    });

    const iva = Math.round(subtotal * 0.19);
    const total = subtotal + iva;

    document.getElementById('pos-subtotal-val').innerText = formatMoney(subtotal);
    document.getElementById('pos-iva-val').innerText = formatMoney(iva);
    document.getElementById('pos-total-val').innerText = formatMoney(total);
}

async function checkoutPos() {
    if (posCart.length === 0) {
        alert('El ticket está vacío.');
        return;
    }

    // In a real application we would have a specific POS product in the SQLite inventory.
    // We will automatically create or query products in the database matching these codes, or create them on the fly
    // Let's check if the codes exist. If not, the backend will query by ID or we map them.
    // For simplicity, we ensure these catalog items correspond to products.
    // Let's check if they exist in cacheInventario. If not, we will register them.
    
    const itemsToCheckout = [];
    for (const cartItem of posCart) {
        let dbItem;
        try {
            dbItem = await fetchApi(`/${activeTenant}/inventario/by-code/${encodeURIComponent(cartItem.codigo)}`);
        } catch (e) {
            // Register on the fly
            const body = {
                codigo: cartItem.codigo,
                descripcion: cartItem.descripcion,
                precio_venta: cartItem.precio,
                costo: cartItem.precio * 0.2, // low cost for services
                iva_tarifa: cartItem.iva,
                stock_actual: 1000,
                stock_minimo: 0,
                activo: 1,
                usuario: 'admin'
            };
            await fetchApi(`/${activeTenant}/inventario`, { method: 'POST', body });
            dbItem = await fetchApi(`/${activeTenant}/inventario/by-code/${encodeURIComponent(cartItem.codigo)}`);
        }
        itemsToCheckout.push({
            producto_id: dbItem.id,
            cantidad: cartItem.qty,
            precio_unitario: cartItem.precio
        });
    }

    const clienteIdVal = parseInt(document.getElementById('pos-cliente').value);
    if (!clienteIdVal) {
        alert('Debe seleccionar un cliente usando el buscador.');
        return;
    }

    const body = {
        cliente_id: clienteIdVal,
        prefijo: 'POS',
        fecha: new Date().toISOString().split('T')[0],
        concepto: 'Venta rápida Taquilla POS Balneario',
        metodo_pago: document.getElementById('pos-pago').value,
        retenciones: { retefuente: false, reteica: false },
        items: itemsToCheckout,
        usuario: 'admin'
    };

    try {
        const result = await fetchApi(`/${activeTenant}/factura`, { method: 'POST', body });
        alert(`Ticket POS procesado y causado con éxito!\nAsiento: FV-${result.numero}\nTotal: ${formatMoney(result.total)}`);
        if (result.asientoId) {
            printConsultedDocument(result.asientoId);
        }
        clearPosCart();
        loadCurrentTenantData();
        changeView('dashboard');
    } catch (e) {
        alert('Falla en checkout POS: ' + e.message);
    }
}

// --- MODULE: RESERVAS (Cancha) ---
function renderReservas(list) {
    const div = document.getElementById('calendar-bookings-list');
    div.innerHTML = '';
    
    if (list.length === 0) {
        div.innerHTML = '<span class="placeholder-text">No hay reservas registradas para esta empresa</span>';
        return;
    }

    list.forEach(r => {
        const item = document.createElement('div');
        item.className = 'booking-item';
        item.innerHTML = `
            <div class="booking-info">
                <h4>${r.recurso} - ${r.cliente_nombre}</h4>
                <p><i class="fa-solid fa-clock"></i> ${r.fecha} de ${r.hora_inicio} a ${r.hora_fin} | ${r.concepto || 'Alquiler general'}</p>
            </div>
            <div class="booking-value">${formatMoney(r.valor)}</div>
        `;
        div.appendChild(item);
    });
}

async function loadReservas() {
    try {
        const data = await fetchApi(`/${activeTenant}/reservas`);
        cacheReservas = data;
        
        // Clear client autocomplete
        const searchInput = document.getElementById('res-cliente-search');
        if (searchInput) searchInput.value = '';
        const hiddenInput = document.getElementById('res-cliente');
        if (hiddenInput) hiddenInput.value = '';

        renderReservas(data);
    } catch (e) {
        console.error('Failed to load bookings:', e);
    }
}

async function submitReserva(e) {
    e.preventDefault();
    const form = document.getElementById('reserva-form');
    
    const clienteIdVal = parseInt(document.getElementById('res-cliente').value);
    if (!clienteIdVal) {
        alert('Debe seleccionar un cliente usando el buscador.');
        return;
    }

    const body = {
        cliente_id: clienteIdVal,
        fecha: form.elements['res-fecha'].value,
        hora_inicio: form.elements['res-inicio'].value,
        hora_fin: form.elements['res-fin'].value,
        recurso: form.elements['res-recurso'].value,
        concepto: form.elements['res-concepto'].value || null,
        valor: parseFloat(form.elements['res-valor'].value) || 0,
        estado: 'CONFIRMADA',
        usuario: 'admin'
    };

    try {
        // Create booking
        await fetchApi(`/${activeTenant}/reservas`, { method: 'POST', body });
        
        // Auto-cause a cash receipt or invoice for the booking in background!
        // We cause a cash receipt into Caja General (11050501) for this rental
        const receiptBody = {
            cliente_id: body.cliente_id,
            fecha: body.fecha,
            concepto: `Causación Alquiler ${body.recurso} (${body.hora_inicio} - ${body.hora_fin})`,
            valor: body.valor,
            metodo_pago: 'efectivo', // default
            usuario: 'admin'
        };
        await fetchApi(`/${activeTenant}/recibo`, { method: 'POST', body: receiptBody });

        form.reset();
        loadReservas();
        alert('Reserva agendada y cobro causado automáticamente en Caja.');
    } catch (e) {
        alert('Error al reservar: ' + e.message);
    }
}

// --- MODULE: TESORERIA (Arqueo & Conciliación) ---
async function loadTesoreriaView() {
    try {
        // Calculate ledger current balances
        const list = await fetchApi(`/${activeTenant}/puc`);
        const balancePrueba = await fetchApi(`/${activeTenant}/reportes/balance-prueba`);
        
        const boxes = document.getElementById('cajas-saldos-calculados');
        boxes.innerHTML = '<h4>Saldos Contables Actuales (Libro Mayor)</h4>';
        
        const targets = ['11050501', '11100508', '11100510'];
        const names = {
            '11050501': 'Caja General Principal',
            '11100508': 'Banco Bancolombia',
            '11100510': 'Nequi'
        };

        targets.forEach(code => {
            // sum debits - credits
            let saldo = 0;
            balancePrueba.forEach(line => {
                if (line.cuenta_codigo === code) {
                    saldo += (line.debito - line.credito);
                }
            });

            const div = document.createElement('div');
            div.className = 'totals-row';
            div.style.margin = '15px 0';
            div.innerHTML = `
                <span><strong>${code} - ${names[code]}:</strong></span>
                <strong style="color:var(--primary); font-size:16px;">${formatMoney(saldo)}</strong>
            `;
            boxes.appendChild(div);
        });

    } catch (e) {
        console.error('Failed to load cashier metrics:', e);
    }
}

async function submitCierreCaja(e) {
    e.preventDefault();
    const form = document.getElementById('cierre-form');
    const accountCode = form.elements['cie-caja'].value;
    const initial = parseFloat(form.elements['cie-inicial'].value) || 0;
    const finalVal = parseFloat(form.elements['cie-final'].value) || 0;

    // Get current ledger balance
    const balancePrueba = await fetchApi(`/${activeTenant}/reportes/balance-prueba`);
    let ledgerVal = 0;
    balancePrueba.forEach(line => {
        if (line.cuenta_codigo === accountCode) {
            ledgerVal += (line.debito - line.credito);
        }
    });

    const diff = finalVal - ledgerVal;
    
    let msg = `Cierre procesado.\n`;
    msg += `Saldo según contabilidad: ${formatMoney(ledgerVal)}\n`;
    msg += `Efectivo reportado: ${formatMoney(finalVal)}\n`;
    
    if (diff === 0) {
        msg += `Cuadre Perfecto. Sin novedades.`;
    } else if (diff > 0) {
        msg += `Sobrante de Caja: ${formatMoney(diff)}. Registrado como ingreso extraordinario.`;
        // Cause receipt for difference
        // In a real app we cause a general journal entry
    } else {
        msg += `Faltante de Caja: ${formatMoney(Math.abs(diff))}. Registrado como cuenta por cobrar a empleado o gasto extraordinario.`;
    }
    
    alert(msg);
    form.reset();
    loadTesoreriaView();
}

// BANK RECONCILIATION EXCEL SIMULATOR
async function runConciliacion() {
    const acc = document.getElementById('con-cuenta').value;
    const simArea = document.getElementById('con-simulated-records').value;
    
    let records = [];
    try {
        records = JSON.parse(simArea || '[]');
    } catch(e) {
        alert('El JSON de transacciones simuladas es inválido.');
        return;
    }

    if (records.length === 0) {
        alert('Por favor, ingresa transacciones simuladas del extracto para iniciar.');
        return;
    }

    try {
        const result = await fetchApi(`/${activeTenant}/conciliacion`, {
            method: 'POST',
            body: { cuenta: acc, records: records }
        });

        document.getElementById('conciliacion-results-box').style.display = 'block';
        document.getElementById('con-res-matched').innerText = result.matchedCount;
        document.getElementById('con-res-unledger').innerText = result.unmatchedLedgerCount;
        document.getElementById('con-res-unbank').innerText = result.unmatchedSheetCount;

        // Render differences
        const tbody = document.querySelector('#con-unbank-table tbody');
        tbody.innerHTML = '';
        
        if (result.unmatchedSheet.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:green; font-weight:bold;">¡Libro conciliado al 100%! Todo cuadra.</td></tr>';
            return;
        }

        result.unmatchedSheet.forEach(rec => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${rec.fecha}</td>
                <td style="color:${rec.valor < 0 ? 'red' : 'green'}; font-weight:bold;">${formatMoney(rec.valor)}</td>
                <td>${rec.tipo.toUpperCase()}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        alert('Error en conciliación: ' + e.message);
    }
}

// --- MODULE: REPORTES & AUXILIARES ---
async function loadReportsView() {
    try {
        // I. Load Balance de Prueba
        const data = await fetchApi(`/${activeTenant}/reportes/balance-prueba`);
        const tbody = document.getElementById('rep-balance-prueba-body');
        tbody.innerHTML = '';
        
        let sumDeb = 0;
        let sumCre = 0;

        data.forEach(line => {
            if (line.debito === 0 && line.credito === 0) return;
            sumDeb += line.debito;
            sumCre += line.credito;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${line.cuenta_codigo}</strong></td>
                <td>${line.cuenta_nombre}</td>
                <td>${line.tercero_nit || ''}</td>
                <td>${line.tercero_nombre || ''}</td>
                <td>${line.centro_costo_codigo || ''}</td>
                <td style="text-align:right;">${formatMoney(line.debito)}</td>
                <td style="text-align:right;">${formatMoney(line.credito)}</td>
            `;
            tbody.appendChild(tr);
        });

        // Totals row
        const trTot = document.createElement('tr');
        trTot.style.fontWeight = 'bold';
        trTot.style.borderTop = '2px solid var(--border)';
        trTot.innerHTML = `
            <td colspan="5">SUMAS IGUALES</td>
            <td style="text-align:right; color:var(--primary);">${formatMoney(sumDeb)}</td>
            <td style="text-align:right; color:var(--primary);">${formatMoney(sumCre)}</td>
        `;
        tbody.appendChild(trTot);

        // II. Load Balance General NIIF
        const balGen = await fetchApi(`/${activeTenant}/reportes/balance-general`);
        const bgBody = document.getElementById('rep-balance-general-body');
        bgBody.innerHTML = '';
        balGen.forEach(line => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${line.grupo}</strong></td>
                <td>${line.grupo_nombre}</td>
                <td style="text-align:right; font-weight:bold; color:${line.saldo < 0 ? 'red' : 'inherit'}">${formatMoney(Math.abs(line.saldo))}</td>
            `;
            bgBody.appendChild(tr);
        });

        // III. Load Estado Resultados NIIF
        const estRes = await fetchApi(`/${activeTenant}/reportes/estado-resultados`);
        const erBody = document.getElementById('rep-estado-resultados-body');
        erBody.innerHTML = '';
        let utility = 0;
        estRes.forEach(line => {
            utility += line.saldo;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${line.grupo}</strong></td>
                <td>${line.grupo_nombre}</td>
                <td style="text-align:right; font-weight:bold;">${formatMoney(line.saldo)}</td>
            `;
            erBody.appendChild(tr);
        });

        const trUt = document.createElement('tr');
        trUt.style.fontWeight = 'bold';
        trUt.style.borderTop = '2px solid var(--border)';
        trUt.innerHTML = `
            <td>-</td>
            <td>UTILIDAD O PÉRDIDA NETA DEL EJERCICIO</td>
            <td style="text-align:right; color:${utility >= 0 ? 'green' : 'red'};">${formatMoney(utility)}</td>
        `;
        erBody.appendChild(trUt);

    } catch (e) {
        console.error('Failed to load reports:', e);
    }
}

async function loadLibroAuxiliarReport() {
    const code = document.getElementById('auxiliar-cuenta-filter').value.trim();
    if (!code) {
        alert('Escribe una cuenta contable.');
        return;
    }
    
    try {
        const data = await fetchApi(`/${activeTenant}/reportes/libro-auxiliar?cuenta=${code}`);
        const tbody = document.getElementById('rep-libro-auxiliar-body');
        tbody.innerHTML = '';

        let saldo = 0;
        data.forEach(line => {
            saldo += (line.debito - line.credito);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${line.cuenta_codigo}</strong></td>
                <td>${line.fecha}</td>
                <td>${line.documento}</td>
                <td>${line.concepto_linea}</td>
                <td>${line.tercero_nombre || ''}</td>
                <td>${line.centro_costo_codigo || ''}</td>
                <td style="text-align:right;">${formatMoney(line.debito)}</td>
                <td style="text-align:right;">${formatMoney(line.credito)}</td>
                <td style="text-align:right; font-weight:bold;">${formatMoney(saldo)}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) {
        alert('Error: ' + e.message);
    }
}

// --- MODULE: EXOGENA DIAN ---
async function loadExogenaReport() {
    const fmt = document.getElementById('exo-format').value;
    try {
        const data = await fetchApi(`/${activeTenant}/reportes/exogena?format=${fmt}`);
        const thead = document.getElementById('exogena-thead');
        const tbody = document.getElementById('exogena-body');
        tbody.innerHTML = '';

        if (fmt === '1001') {
            thead.innerHTML = `
                <tr>
                    <th>Concepto/Doc</th>
                    <th>Identificación</th>
                    <th>DV</th>
                    <th>Primer Nombre / Razón Social</th>
                    <th>Apellidos</th>
                    <th>Dirección</th>
                    <th>Ciudad</th>
                    <th>Pago o Abono en Cuenta (Débito)</th>
                </tr>
            `;

            data.forEach(line => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${line.tipo_documento}</td>
                    <td><strong>${line.identificacion}</strong></td>
                    <td>${line.dv || ''}</td>
                    <td>${line.nombre}</td>
                    <td>${line.apellidos || ''}</td>
                    <td>${line.direccion || ''}</td>
                    <td>${line.ciudad}</td>
                    <td style="text-align:right; font-weight:bold;">${formatMoney(line.pago_acumulado)}</td>
                `;
                tbody.appendChild(tr);
            });
        } else if (fmt === '1007') {
            thead.innerHTML = `
                <tr>
                    <th>Concepto/Doc</th>
                    <th>Identificación</th>
                    <th>DV</th>
                    <th>Primer Nombre / Razón Social</th>
                    <th>Apellidos</th>
                    <th>Ingresos Acumulados Recibidos (Crédito)</th>
                </tr>
            `;

            data.forEach(line => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${line.tipo_documento}</td>
                    <td><strong>${line.identificacion}</strong></td>
                    <td>${line.dv || ''}</td>
                    <td>${line.nombre}</td>
                    <td>${line.apellidos || ''}</td>
                    <td style="text-align:right; font-weight:bold;">${formatMoney(line.ingresos_acumulados)}</td>
                `;
                tbody.appendChild(tr);
            });
        }

    } catch (e) {
        alert(e.message);
    }
}

// --- MODULE: FICHA DE INFORMES OPERACIONALES ---
// --- MODULE: FICHA DE INFORMES OPERACIONALES ---
let activeOpReportTab = 'rep-op-ventas';

function switchOpReportTab(tabId) {
    activeOpReportTab = tabId;
    
    // Hide keypad
    document.getElementById('rep-op-keypad').style.display = 'none';
    // Show details
    document.getElementById('rep-op-detail-container').style.display = 'block';

    // Switch active tab content
    const container = document.getElementById('view-reportes-operacionales');
    container.querySelectorAll('.tab-content').forEach(tab => {
        if (tab.id === `tab-${tabId}`) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Load data for the selected tab
    if (tabId === 'rep-op-ventas') loadReporteVentas();
    else if (tabId === 'rep-op-compras') loadReporteCompras();
    else if (tabId === 'rep-op-cartera') loadReporteCartera();
    else if (tabId === 'rep-op-proveedores') loadReporteProveedores();
    else if (tabId === 'rep-op-gastos') loadReporteGastos();
    else if (tabId === 'rep-op-caja-diario') loadReporteCajaDiario();
}

function goBackToReportsKeypad() {
    document.getElementById('rep-op-keypad').style.display = 'grid';
    document.getElementById('rep-op-detail-container').style.display = 'none';
}

function initOpReportDates() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const formatDate = (d) => d.toISOString().split('T')[0];

    const fields = [
        ['rep-sales-desde', 'rep-sales-hasta'],
        ['rep-purch-desde', 'rep-purch-hasta'],
        ['rep-expenses-desde', 'rep-expenses-hasta']
    ];

    fields.forEach(([desdeId, hastaId]) => {
        const desde = document.getElementById(desdeId);
        const hasta = document.getElementById(hastaId);
        if (desde && !desde.value) desde.value = formatDate(firstDay);
        if (hasta && !hasta.value) hasta.value = formatDate(today);
    });

    const repCajaFecha = document.getElementById('rep-caja-fecha');
    if (repCajaFecha && !repCajaFecha.value) {
        repCajaFecha.value = formatDate(today);
    }
}

async function loadReportesOperacionalesView() {
    initOpReportDates();
    goBackToReportsKeypad();
}

async function loadNextDocumentNumbers() {
    try {
        const fvPrefijo = document.getElementById('fac-prefijo') ? document.getElementById('fac-prefijo').value.trim() : 'SET';
        const [fvRes, dsRes, ceRes, rcRes, nmRes, ncRes] = await Promise.all([
            fetchApi(`/${activeTenant}/next-number/FV?prefijo=${fvPrefijo}`),
            fetchApi(`/${activeTenant}/next-number/DS`),
            fetchApi(`/${activeTenant}/next-number/CE`),
            fetchApi(`/${activeTenant}/next-number/RC`),
            fetchApi(`/${activeTenant}/next-number/NM`),
            fetchApi(`/${activeTenant}/next-number/NC`)
        ]);

        if (document.getElementById('lbl-next-number-fv')) {
            document.getElementById('lbl-next-number-fv').textContent = `Factura No. ${fvPrefijo}-${fvRes.nextNumber}`;
        }
        if (document.getElementById('lbl-next-number-ds')) {
            document.getElementById('lbl-next-number-ds').textContent = `Soporte No. DS-${dsRes.nextNumber}`;
        }
        if (document.getElementById('lbl-next-number-ce')) {
            document.getElementById('lbl-next-number-ce').textContent = `Comprobante No. CE-${ceRes.nextNumber}`;
        }
        if (document.getElementById('lbl-next-number-rc')) {
            document.getElementById('lbl-next-number-rc').textContent = `Recibo No. RC-${rcRes.nextNumber}`;
        }
        if (document.getElementById('lbl-next-number-nm')) {
            document.getElementById('lbl-next-number-nm').textContent = `Nómina No. NM-${nmRes.nextNumber}`;
        }
        if (document.getElementById('lbl-next-number-nc')) {
            document.getElementById('lbl-next-number-nc').textContent = `Nota No. NC-${ncRes.nextNumber}`;
        }
    } catch (e) {
        console.error('Error al cargar números consecutivos:', e);
    }
}

let lastCajaDiarioData = null;

async function loadReporteCajaDiario() {
    const fecha = document.getElementById('rep-caja-fecha').value;
    try {
        const data = await fetchApi(`/${activeTenant}/reportes/caja-diario?fecha=${fecha}`);
        lastCajaDiarioData = data;
        
        // A. Detailed cash movements
        const detailsBody = document.getElementById('rep-op-caja-details-body');
        detailsBody.innerHTML = '';
        if (data.cashMovementsDetail && data.cashMovementsDetail.length > 0) {
            data.cashMovementsDetail.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${item.tipo_documento}-${item.numero}</strong></td>
                    <td>${item.fecha}</td>
                    <td>${item.tercero_nombre || ''}</td>
                    <td>${item.concepto}</td>
                    <td style="text-align:right; font-weight: 600; color: #0d9488;">${item.debito > 0 ? formatMoney(item.debito) : ''}</td>
                    <td style="text-align:right; font-weight: 600; color: #b91c1c;">${item.credito > 0 ? formatMoney(item.credito) : ''}</td>
                `;
                detailsBody.appendChild(tr);
            });
        } else {
            detailsBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#6b7280;">No hubo movimientos en caja para este día.</td></tr>`;
        }

        // B. Sales by payment method
        const salesBody = document.getElementById('rep-op-caja-sales-body');
        salesBody.innerHTML = '';
        if (data.salesByPayment && data.salesByPayment.length > 0) {
            data.salesByPayment.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.forma_pago}</td>
                    <td style="text-align:right; font-weight: 600;">${formatMoney(item.total)}</td>
                `;
                salesBody.appendChild(tr);
            });
        } else {
            salesBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#6b7280;">No se registraron ventas en esta fecha.</td></tr>`;
        }

        // C. Receipts by account
        const receiptsBody = document.getElementById('rep-op-caja-receipts-body');
        receiptsBody.innerHTML = '';
        if (data.receiptsByAccount && data.receiptsByAccount.length > 0) {
            data.receiptsByAccount.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.cuenta_nombre}</td>
                    <td style="text-align:right; font-weight: 600; color: #0d9488;">${formatMoney(item.total)}</td>
                `;
                receiptsBody.appendChild(tr);
            });
        } else {
            receiptsBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#6b7280;">No se registraron recibos de caja en esta fecha.</td></tr>`;
        }

        // D. Egresos by account
        const egresosBody = document.getElementById('rep-op-caja-egresos-body');
        egresosBody.innerHTML = '';
        if (data.egresosByAccount && data.egresosByAccount.length > 0) {
            data.egresosByAccount.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.cuenta_nombre}</td>
                    <td style="text-align:right; font-weight: 600; color: #b91c1c;">${formatMoney(item.total)}</td>
                `;
                egresosBody.appendChild(tr);
            });
        } else {
            egresosBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#6b7280;">No se registraron egresos en esta fecha.</td></tr>`;
        }

        // E. Expenses summary
        const expensesBody = document.getElementById('rep-op-caja-expenses-body');
        expensesBody.innerHTML = '';
        if (data.expensesSummary && data.expensesSummary.length > 0) {
            data.expensesSummary.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.cuenta_codigo}</td>
                    <td>${item.cuenta_nombre}</td>
                    <td style="text-align:right; font-weight: 600; color: #b91c1c;">${formatMoney(item.total)}</td>
                `;
                expensesBody.appendChild(tr);
            });
        } else {
            expensesBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280;">No se registraron gastos en esta fecha.</td></tr>`;
        }

        // F. Caja General Reconciliation card
        const cg = data.cajaGeneral || { saldoInicial: 0, ingresosCaja: 0, egresosCaja: 0, saldoFinal: 0 };
        document.getElementById('rep-caja-saldo-inicial').textContent = formatMoney(cg.saldoInicial);
        document.getElementById('rep-caja-ingresos').textContent = `+ ${formatMoney(cg.ingresosCaja)}`;
        document.getElementById('rep-caja-egresos').textContent = `- ${formatMoney(cg.egresosCaja)}`;
        document.getElementById('rep-caja-saldo-final').textContent = formatMoney(cg.saldoFinal);

    } catch (e) {
        alert('Error al cargar reporte de caja diario: ' + e.message);
    }
}

function printReporteCajaDiario() {
    if (!lastCajaDiarioData) {
        alert('Por favor, consulte el reporte de una fecha primero.');
        return;
    }
    const fecha = document.getElementById('rep-caja-fecha').value;
    const tenantName = activeTenant === 'importadora' ? 'IMPORTADORA KYH SAS' : 'CLUB SOL DEL VALLE';
    const tenantNit = activeTenant === 'importadora' ? '901785745-5' : '800.987.654-3';

    let html = `
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 3px double #0d9488; padding-bottom: 10px;">
            <h1 style="margin: 0; color: #0d9488; font-size: 24px;">${tenantName}</h1>
            <p style="margin: 3px 0; font-size: 13px; color: #666;">NIT: ${tenantNit} | Reporte de Caja Diario</p>
            <p style="margin: 3px 0; font-weight: bold; font-size: 14px;">Fecha del Informe: ${fecha}</p>
        </div>

        <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 10px 0; color: #0d9488; font-size: 16px; border-bottom: 1px solid #99f6e4; padding-bottom: 5px;">Conciliación de Caja General</h3>
            <table style="width: 100%; font-size: 14px;">
                <tr>
                    <td><strong>Saldo Inicial (Día Anterior):</strong></td>
                    <td style="text-align: right;">${formatMoney(lastCajaDiarioData.cajaGeneral.saldoInicial)}</td>
                </tr>
                <tr style="color: #0f766e;">
                    <td>(+) Ingresos del Día:</td>
                    <td style="text-align: right;">+ ${formatMoney(lastCajaDiarioData.cajaGeneral.ingresosCaja)}</td>
                </tr>
                <tr style="color: #b91c1c;">
                    <td>(-) Egresos del Día:</td>
                    <td style="text-align: right;">- ${formatMoney(lastCajaDiarioData.cajaGeneral.egresosCaja)}</td>
                </tr>
                <tr style="font-size: 16px; font-weight: bold; color: #0d9488;">
                    <td>Saldo Final de Caja:</td>
                    <td style="text-align: right; border-top: 1px solid #0d9488;">${formatMoney(lastCajaDiarioData.cajaGeneral.saldoFinal)}</td>
                </tr>
            </table>
        </div>

        <h3 style="color: #0d9488; border-bottom: 1px solid #ddd; margin-top: 25px;">1. Movimientos de Caja General (Detalle por Documento)</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px;">
            <thead>
                <tr style="background: #f3f4f6; border-bottom: 2px solid #ccc;">
                    <th style="padding: 6px; text-align: left;">Documento</th>
                    <th style="padding: 6px; text-align: left;">Fecha</th>
                    <th style="padding: 6px; text-align: left;">Tercero</th>
                    <th style="padding: 6px; text-align: left;">Concepto</th>
                    <th style="padding: 6px; text-align: right;">Ingreso (+)</th>
                    <th style="padding: 6px; text-align: right;">Egreso (-)</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (lastCajaDiarioData.cashMovementsDetail && lastCajaDiarioData.cashMovementsDetail.length > 0) {
        lastCajaDiarioData.cashMovementsDetail.forEach(item => {
            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 6px;"><strong>${item.tipo_documento}-${item.numero}</strong></td>
                    <td style="padding: 6px;">${item.fecha}</td>
                    <td style="padding: 6px;">${item.tercero_nombre}</td>
                    <td style="padding: 6px;">${item.concepto}</td>
                    <td style="padding: 6px; text-align: right; color: #0d9488;">${item.debito > 0 ? formatMoney(item.debito) : ''}</td>
                    <td style="padding: 6px; text-align: right; color: #b91c1c;">${item.credito > 0 ? formatMoney(item.credito) : ''}</td>
                </tr>
            `;
        });
    } else {
        html += `<tr><td colspan="6" style="padding: 10px; text-align: center; color: #666;">No hubo movimientos en caja para este día.</td></tr>`;
    }

    html += `
            </tbody>
        </table>

        <h3 style="color: #0d9488; border-bottom: 1px solid #ddd; margin-top: 25px;">2. Ventas del Día por Forma de Pago</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px;">
            <thead>
                <tr style="background: #f3f4f6; border-bottom: 2px solid #ccc;">
                    <th style="padding: 6px; text-align: left;">Forma de Pago</th>
                    <th style="padding: 6px; text-align: right;">Valor Total</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (lastCajaDiarioData.salesByPayment && lastCajaDiarioData.salesByPayment.length > 0) {
        lastCajaDiarioData.salesByPayment.forEach(item => {
            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 6px;">${item.forma_pago}</td>
                    <td style="padding: 6px; text-align: right; font-weight: bold;">${formatMoney(item.total)}</td>
                </tr>
            `;
        });
    } else {
        html += `<tr><td colspan="2" style="padding: 10px; text-align: center; color: #666;">No se registraron ventas.</td></tr>`;
    }

    html += `
            </tbody>
        </table>

        <h3 style="color: #0d9488; border-bottom: 1px solid #ddd; margin-top: 25px;">3. Resumen de Gastos de la Jornada</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px;">
            <thead>
                <tr style="background: #f3f4f6; border-bottom: 2px solid #ccc;">
                    <th style="padding: 6px; text-align: left;">Cuenta</th>
                    <th style="padding: 6px; text-align: left;">Concepto</th>
                    <th style="padding: 6px; text-align: right;">Valor Gasto</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (lastCajaDiarioData.expensesSummary && lastCajaDiarioData.expensesSummary.length > 0) {
        lastCajaDiarioData.expensesSummary.forEach(item => {
            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 6px;">${item.cuenta_codigo}</td>
                    <td style="padding: 6px;">${item.cuenta_nombre}</td>
                    <td style="padding: 6px; text-align: right; color: #b91c1c; font-weight: bold;">${formatMoney(item.total)}</td>
                </tr>
            `;
        });
    } else {
        html += `<tr><td colspan="3" style="padding: 10px; text-align: center; color: #666;">No se registraron gastos.</td></tr>`;
    }

    html += `
            </tbody>
        </table>
        
        <div style="margin-top: 50px; text-align: center; font-size: 11px; color: #999;">
            <p>Simplix ERP - Control Operacional de Caja General. Generado el ${new Date().toLocaleString()}</p>
        </div>
    `;

    sendToPrinter(html);
}

async function loadReporteVentas() {
    const desde = document.getElementById('rep-sales-desde').value;
    const hasta = document.getElementById('rep-sales-hasta').value;
    const tipo = document.getElementById('rep-sales-tipo').value;
    try {
        const data = await fetchApi(`/${activeTenant}/reportes/ventas?desde=${desde}&hasta=${hasta}&tipo=${tipo}`);
        const tbody = document.getElementById('rep-op-ventas-body');
        tbody.innerHTML = '';

        let subtotal = 0;
        let iva = 0;
        let neto = 0;

        data.forEach(line => {
            subtotal += line.subtotal;
            iva += line.iva;
            neto += line.total_documento;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><a href="#" onclick="viewAsientoDetails(${line.id}); return false;" style="font-weight: bold; color: var(--primary); text-decoration: underline;">${line.prefijo ? line.prefijo + '-' : ''}${line.numero}</a></td>
                <td>${line.fecha}</td>
                <td>${line.tercero_nit || ''}</td>
                <td>${line.tercero_nombre || ''}</td>
                <td style="color:var(--primary); font-weight:500;">${line.productos || 'Producto Integrado'}</td>
                <td style="text-align:right;">${formatMoney(line.subtotal)}</td>
                <td style="text-align:right;">${formatMoney(line.iva)}</td>
                <td style="text-align:right; font-weight:bold;">${formatMoney(line.total_documento)}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('rep-sales-tot-subtotal').innerText = formatMoney(subtotal);
        document.getElementById('rep-sales-tot-iva').innerText = formatMoney(iva);
        document.getElementById('rep-sales-tot-neto').innerText = formatMoney(neto);

    } catch (e) {
        alert('Error cargando informe de ventas: ' + e.message);
    }
}

async function loadReporteCompras() {
    const desde = document.getElementById('rep-purch-desde').value;
    const hasta = document.getElementById('rep-purch-hasta').value;
    try {
        const data = await fetchApi(`/${activeTenant}/reportes/compras?desde=${desde}&hasta=${hasta}`);
        const tbody = document.getElementById('rep-op-compras-body');
        tbody.innerHTML = '';

        let subtotal = 0;
        let iva = 0;
        let retefte = 0;
        let neto = 0;

        data.forEach(line => {
            subtotal += line.subtotal;
            iva += line.iva;
            retefte += line.retefuente;
            neto += line.total_documento;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><a href="#" onclick="viewAsientoDetails(${line.id}); return false;" style="font-weight: bold; color: var(--primary); text-decoration: underline;">${line.prefijo ? line.prefijo + '-' : ''}${line.numero}</a></td>
                <td>${line.fecha}</td>
                <td>${line.tercero_nit || ''}</td>
                <td>${line.tercero_nombre || ''}</td>
                <td style="color:var(--primary); font-weight:500;">${line.productos || 'Producto Integrado'}</td>
                <td style="text-align:right;">${formatMoney(line.subtotal)}</td>
                <td style="text-align:right;">${formatMoney(line.iva)}</td>
                <td style="text-align:right;">${formatMoney(line.retefuente)}</td>
                <td style="text-align:right; font-weight:bold;">${formatMoney(line.total_documento)}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('rep-purch-tot-subtotal').innerText = formatMoney(subtotal);
        document.getElementById('rep-purch-tot-iva').innerText = formatMoney(iva);
        document.getElementById('rep-purch-tot-retefte').innerText = formatMoney(retefte);
        document.getElementById('rep-purch-tot-neto').innerText = formatMoney(neto);

    } catch (e) {
        alert('Error cargando informe de compras: ' + e.message);
    }
}

async function loadReporteCartera() {
    try {
        const data = await fetchApi(`/${activeTenant}/reportes/cuentas-por-cobrar`);
        currentCarteraData = data;
        
        const searchInput = document.getElementById('rep-cartera-search');
        if (searchInput) searchInput.value = '';
        
        renderReporteCartera(data);
    } catch (e) {
        alert('Error cargando cuentas por cobrar: ' + e.message);
    }
}

function renderReporteCartera(data) {
    const tbody = document.getElementById('rep-op-cartera-body');
    tbody.innerHTML = '';

    const query = (document.getElementById('rep-cartera-search')?.value || '').toLowerCase().trim();
    
    const filteredData = data.filter(line => {
        if (!query) return true;
        const nameMatch = line.tercero_nombre ? line.tercero_nombre.toLowerCase().includes(query) : false;
        const nitMatch = line.tercero_nit ? line.tercero_nit.toLowerCase().includes(query) : false;
        return nameMatch || nitMatch;
    });

    let totalOriginal = 0;
    let totalAbonos = 0;
    let totalSaldo = 0;

    filteredData.forEach(line => {
        totalOriginal += line.valorOriginal;
        totalAbonos += line.abonos;
        totalSaldo += line.saldo;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${line.tercero_nit}</strong></td>
            <td>${line.tercero_nombre}</td>
            <td>${line.documento}</td>
            <td>${line.fecha}</td>
            <td style="text-align:right;">${formatMoney(line.valorOriginal)}</td>
            <td style="text-align:right; color:green;">${formatMoney(line.abonos)}</td>
            <td style="text-align:right; font-weight:bold; color:#b91c1c;">${formatMoney(line.saldo)}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('rep-cart-tot-original').innerText = formatMoney(totalOriginal);
    document.getElementById('rep-cart-tot-abonos').innerText = formatMoney(totalAbonos);
    document.getElementById('rep-cart-tot-saldo').innerText = formatMoney(totalSaldo);
}

function filterReporteCartera() {
    renderReporteCartera(currentCarteraData);
}

async function loadReporteProveedores() {
    try {
        const data = await fetchApi(`/${activeTenant}/reportes/cuentas-por-pagar`);
        currentProveedoresData = data;
        
        const searchInput = document.getElementById('rep-proveedores-search');
        if (searchInput) searchInput.value = '';
        
        renderReporteProveedores(data);
    } catch (e) {
        alert('Error cargando cuentas por pagar: ' + e.message);
    }
}

function renderReporteProveedores(data) {
    const tbody = document.getElementById('rep-op-proveedores-body');
    tbody.innerHTML = '';

    const query = (document.getElementById('rep-proveedores-search')?.value || '').toLowerCase().trim();
    
    const filteredData = data.filter(line => {
        if (!query) return true;
        const nameMatch = line.tercero_nombre ? line.tercero_nombre.toLowerCase().includes(query) : false;
        const nitMatch = line.tercero_nit ? line.tercero_nit.toLowerCase().includes(query) : false;
        return nameMatch || nitMatch;
    });

    let totalOriginal = 0;
    let totalAbonos = 0;
    let totalSaldo = 0;

    filteredData.forEach(line => {
        totalOriginal += line.valorOriginal;
        totalAbonos += line.abonos;
        totalSaldo += line.saldo;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${line.tercero_nit}</strong></td>
            <td>${line.tercero_nombre}</td>
            <td>${line.documento}</td>
            <td>${line.fecha}</td>
            <td style="text-align:right;">${formatMoney(line.valorOriginal)}</td>
            <td style="text-align:right; color:green;">${formatMoney(line.abonos)}</td>
            <td style="text-align:right; font-weight:bold; color:#b91c1c;">${formatMoney(line.saldo)}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('rep-prov-tot-original').innerText = formatMoney(totalOriginal);
    document.getElementById('rep-prov-tot-abonos').innerText = formatMoney(totalAbonos);
    document.getElementById('rep-prov-tot-saldo').innerText = formatMoney(totalSaldo);
}

function filterReporteProveedores() {
    renderReporteProveedores(currentProveedoresData);
}

async function loadReporteGastos() {
    const desde = document.getElementById('rep-expenses-desde').value;
    const hasta = document.getElementById('rep-expenses-hasta').value;
    try {
        const data = await fetchApi(`/${activeTenant}/reportes/gastos?desde=${desde}&hasta=${hasta}`);
        
        // 1. Group summary
        const summary = {};
        let totalExpenses = 0;

        data.forEach(line => {
            const grpCode = line.cuenta_codigo.slice(0, 4);
            const grpName = line.cuenta_nombre;
            
            // Descriptive subaccount labeling
            let displayName = grpName;
            if (line.cuenta_codigo.startsWith('5105')) displayName = 'SUELDOS Y BENEFICIOS';
            else if (line.cuenta_codigo.startsWith('5120')) displayName = 'ARRENDAMIENTOS (ARRIENDO)';
            else if (line.cuenta_codigo.startsWith('5195')) displayName = 'DIVERSOS (GASOLINA / OTROS)';

            if (!summary[grpCode]) {
                summary[grpCode] = {
                    code: grpCode,
                    name: displayName,
                    valor: 0
                };
            }
            summary[grpCode].valor += line.valor;
            totalExpenses += line.valor;
        });

        const sumBody = document.getElementById('rep-op-gastos-summary-body');
        sumBody.innerHTML = '';
        Object.values(summary).forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${row.code}</strong></td>
                <td>${row.name}</td>
                <td style="text-align:right; font-weight:bold;">${formatMoney(row.valor)}</td>
            `;
            sumBody.appendChild(tr);
        });

        // 2. Load detailed log
        const tbody = document.getElementById('rep-op-gastos-body');
        tbody.innerHTML = '';

        data.forEach(line => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${line.cuenta_codigo}</strong></td>
                <td>${line.cuenta_nombre}</td>
                <td>${line.fecha}</td>
                <td>${line.documento}</td>
                <td>${line.tercero_nombre || ''} (${line.tercero_nit || ''})</td>
                <td>${line.concepto_linea || ''}</td>
                <td style="text-align:right; font-weight:bold;">${formatMoney(line.valor)}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('rep-expenses-tot-val').innerText = formatMoney(totalExpenses);

    } catch (e) {
        alert('Error cargando gastos: ' + e.message);
    }
}

// MIGRATION FROM WORLD OFFICE SQL SERVER TRIGGER
async function runDatabaseMigration() {
    const statusDiv = document.getElementById('migration-status');
    statusDiv.innerHTML = '<span style="color:var(--accent); font-weight:bold;"><i class="fa-solid fa-arrows-spin fa-spin"></i> Conectando con Microsoft SQL Server y migrando base de datos...</span>';

    try {
        const result = await fetchApi('/migracion', { method: 'POST' });
        statusDiv.innerHTML = `
            <div style="background-color:rgba(16,185,129,0.1); border:1px solid var(--primary); padding:15px; border-radius:8px; margin-top:10px;">
                <h4 style="color:green; margin-bottom:5px;"><i class="fa-solid fa-circle-check"></i> ¡Migración Exitosa!</h4>
                <p>Cuentas contables importadas: <strong>${result.stats.pucCount}</strong></p>
                <p>Terceros importados: <strong>${result.stats.tercerosCount}</strong></p>
                <p>Autopartes y productos importados: <strong>${result.stats.inventarioCount}</strong></p>
            </div>
        `;
        // Reload all data list caches
        loadCurrentTenantData();
    } catch (e) {
        statusDiv.innerHTML = `<span style="color:red; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> Error en la migración: ${e.message}</span>`;
    }
}

// TREINTA EXCEL IMPORT FOR CLUB INVENTORY
async function importTreintaInventory() {
    const statusDiv = document.getElementById('treinta-status');
    statusDiv.innerHTML = '<span style="color:var(--primary); font-weight:bold;"><i class="fa-solid fa-spinner fa-spin"></i> Procesando archivo de Treinta e importando productos...</span>';
    
    try {
        const result = await fetchApi(`/${activeTenant}/importar-treinta`, { method: 'POST' });
        statusDiv.innerHTML = `<span style="color:green; font-weight:bold;"><i class="fa-solid fa-circle-check"></i> Carga Exitosa. Se importaron <strong>${result.stats.inventarioCount}</strong> productos de Treinta al catálogo del Club.</span>`;
        loadInventario();
    } catch (e) {
        statusDiv.innerHTML = `<span style="color:red; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> Error en la importación: ${e.message}</span>`;
    }
}

// OTHER DOCUMENT UTILITIES
async function voidDocument(asientoId) {
    if (!confirm('¿Está seguro de que desea anular este documento? Esto creará un contraasiento revertiendo los saldos a cero de acuerdo con las normas contables.')) {
        return;
    }
    try {
        await fetchApi(`/${activeTenant}/anular/${asientoId}`, { method: 'POST', body: { usuario: 'admin' } });
        updateDashboardMetrics();
    } catch(e) {
        alert(e.message);
    }
}

async function viewAsientoDetails(id) {
    try {
        const data = await fetchApi(`/${activeTenant}/asientos/detalles/${id}`);
        let detailsHtml = '';
        
        let isFV = false;
        let escapedEmail = '';
        let prefijo = '';
        let numero = '';
        let totalVal = 0;
        
        if (data.header.tipo_documento === 'FV') {
            const isImportadora = activeTenant === 'importadora';
            const companyName = isImportadora ? 'IMPORTADORA KYH SAS' : 'CLUB SOL DEL VALLE';
            const companyNit = isImportadora ? '901785745-5' : '800.987.654-3';
            const companyAddress = isImportadora ? 'Carrera 6 # 0 - 56 Cajica' : 'Kilómetro 4 Vía al Mar, Cali';
            const companyPhone = isImportadora ? '2334354950' : '3157654321';
            const companyWeb = isImportadora ? 'Repuestoscajica.com' : 'clubsoldelvalle.com';
            const companyEmail = isImportadora ? 'contacto@repuestoscajica.com' : 'contacto@clubsoldelvalle.com';

            const customerLine = data.details.find(d => d.tercero_nit) || {};
            const customerName = customerLine.tercero_nombre || 'Cliente General';
            const customerNit = customerLine.tercero_nit || 'S/D';
            const customerAddress = customerLine.tercero_direccion || 'No Registrada';
            const customerCity = customerLine.tercero_ciudad || 'Cajicá';
            const customerPhone = customerLine.tercero_telefono || 'S/D';
            const customerEmail = customerLine.tercero_email || 'S/D';

            const items = data.details.filter(d => d.cuenta_codigo && d.cuenta_codigo.startsWith('41') && d.cuenta_codigo !== '4175');
            
            let itemsHtml = '';
            let subtotalVal = 0;
            items.forEach((item, idx) => {
                const qty = item.cantidad || 1;
                const price = item.precio_unitario || item.credito;
                const sub = item.credito || (qty * price);
                subtotalVal += sub;
                
                const descText = item.producto_descripcion || item.concepto_linea || 'Producto';
                const skuText = item.producto_sku || 'S/D';
                
                let descHtml = descText;
                let skuHtml = skuText;
                
                if (item.inventario_id) {
                    descHtml = `<a href="#" onclick="const m = document.querySelector('.modal.active'); if(m) m.remove(); setTimeout(() => viewProductKardex(${item.inventario_id}), 150); return false;" style="font-weight: 600; color: var(--primary); text-decoration: underline;">${descText}</a>`;
                    skuHtml = `<a href="#" onclick="const m = document.querySelector('.modal.active'); if(m) m.remove(); setTimeout(() => viewProductKardex(${item.inventario_id}), 150); return false;" style="font-weight: 700; color: var(--primary); text-decoration: underline; font-family: monospace;">${skuText}</a>`;
                }
                
                itemsHtml += `
                    <tr style="border-bottom: 1px solid #f1f5f9; background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding: 8px 12px; color: #64748b;">${idx + 1}</td>
                        <td style="padding: 8px 12px;">${skuHtml}</td>
                        <td style="padding: 8px 12px; color: #0f172a; font-weight: 500;">${descHtml}</td>
                        <td style="padding: 8px 12px; text-align: center; font-family: monospace; font-size: 12px; font-weight: 600; color: #334155;">${qty}</td>
                        <td style="padding: 8px 12px; text-align: right; font-family: monospace; font-size: 12px; font-weight: 600; color: #334155;">${formatMoney(price)}</td>
                        <td style="padding: 8px 12px; text-align: right; font-family: monospace; font-size: 12px; font-weight: 700; color: #0f172a;">${formatMoney(sub)}</td>
                    </tr>
                `;
            });

            const ivaLine = data.details.find(d => d.cuenta_codigo === '2408');
            const totalIvaVal = ivaLine ? ivaLine.credito : 0;

            const discountLine = data.details.find(d => d.cuenta_codigo === '4175');
            const totalDiscountVal = discountLine ? discountLine.debito : 0;

            const reteFteLine = data.details.find(d => d.cuenta_codigo.startsWith('13') && d.concepto_linea && d.concepto_linea.toLowerCase().includes('fuente'));
            const totalReteFte = reteFteLine ? reteFteLine.debito : 0;

            const reteIcaLine = data.details.find(d => d.cuenta_codigo.startsWith('13') && d.concepto_linea && d.concepto_linea.toLowerCase().includes('ica'));
            const totalReteIca = reteIcaLine ? reteIcaLine.debito : 0;

            const totalNetVal = data.header.total_documento;
            
            isFV = true;
            escapedEmail = customerEmail.replace(/'/g, "\\'");
            prefijo = data.header.prefijo || 'FV';
            numero = data.header.numero;
            totalVal = totalNetVal;
            
            const paymentMethod = data.header.concepto && data.header.concepto.toLowerCase().includes('efectivo') ? 'efectivo' : 
                                  (data.header.concepto && data.header.concepto.toLowerCase().includes('bancolombia') ? 'bancolombia' : 
                                  (data.header.concepto && data.header.concepto.toLowerCase().includes('nequi') ? 'nequi' : 'crédito'));

            const docTitle = data.header.tipo_documento === 'FV' ? 'FACTURA ELECTRÓNICA DE VENTA' : 'FACTURA DE VENTA';

            let doubleEntryRows = '';
            let totalDeb = 0;
            let totalCre = 0;
            data.details.forEach(d => {
                totalDeb += d.debito;
                totalCre += d.credito;
                
                let descText = d.cuenta_nombre;
                if (d.inventario_id) {
                    descText += ` <a href="#" onclick="const m = document.querySelector('.modal.active'); if(m) m.remove(); setTimeout(() => viewProductKardex(${d.inventario_id}), 150); return false;" style="color: var(--primary); text-decoration: underline; font-weight: 600; font-size: 10px; margin-left: 6px;"><i class="fa-solid fa-square-poll-vertical"></i> Kardex</a>`;
                }
                if (d.concepto_linea) {
                    descText += `<div style="font-size: 9px; color: var(--text-muted); font-style: italic; margin-top: 2px;">${d.concepto_linea}</div>`;
                }
                
                doubleEntryRows += `
                    <tr>
                        <td><strong>${d.cuenta_codigo}</strong></td>
                        <td>${descText}</td>
                        <td>${d.tercero_nombre || ''}</td>
                        <td>${d.centro_costo_codigo || ''}</td>
                        <td style="text-align:right;">${formatMoney(d.debito)}</td>
                        <td style="text-align:right;">${formatMoney(d.credito)}</td>
                    </tr>
                `;
            });

            detailsHtml = `
                <div class="premium-invoice-modal" style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03); max-height: 520px; overflow-y: auto; background-color: #ffffff; border-top: 5px solid var(--primary); font-family: var(--font-main);">
                    <!-- Header: Company & Invoice Info -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 16px; gap: 20px;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                <div style="background-color: var(--primary); color: #fff; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.2);">
                                    ${companyName[0]}
                                </div>
                                <h2 style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0; letter-spacing: -0.3px;">${companyName}</h2>
                            </div>
                            <div style="font-size: 11px; color: #64748b; line-height: 1.5;">
                                <div><strong>NIT:</strong> ${companyNit} | Régimen Común</div>
                                <div><strong>Dirección:</strong> ${companyAddress}</div>
                                <div><strong>WhatsApp:</strong> ${companyPhone} | <strong>Email:</strong> ${companyEmail}</div>
                                <div style="margin-top: 4px; font-size: 9px; opacity: 0.85; font-style: italic; color: #94a3b8;">
                                    ${isImportadora 
                                        ? 'Autorización de Facturación DIAN No. 18764096884046 del 2025-08-11 | Prefijo: FVE | Rango: 1001 al 2000 | Vigencia: 24 meses'
                                        : 'Autorización de Facturación DIAN No. 187640000001 de 2026-01-15 | Rango: FV-1 a FV-100000'}
                                </div>
                            </div>
                        </div>
                        <div style="text-align: right; min-width: 220px;">
                            <div style="background-color: #f1f5f9; color: #334155; display: inline-block; padding: 4px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; border-radius: 6px; margin-bottom: 8px; letter-spacing: 0.5px; border: 1px solid #e2e8f0;">
                                ${docTitle}
                            </div>
                            <div style="font-size: 20px; font-weight: 800; color: var(--primary); margin-bottom: 8px; font-family: var(--font-heading);">${data.header.prefijo || 'FV'}-${data.header.numero}</div>
                            <div style="font-size: 11px; color: #64748b; line-height: 1.5; display: inline-block; text-align: left; background: #f8fafc; padding: 6px 12px; border-radius: 6px; border: 1px solid #f1f5f9;">
                                <div><strong>Fecha Emisión:</strong> <span style="color: #334155;">${data.header.fecha}</span></div>
                                <div><strong>Medio de Pago:</strong> <span style="text-transform: capitalize; color: #334155;">${paymentMethod}</span></div>
                            </div>
                        </div>
                    </div>

                    <!-- Customer Section -->
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
                        <h4 style="font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin: 0 0 10px 0; letter-spacing: 0.5px; text-transform: uppercase; font-family: var(--font-heading); display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-user-tie" style="color: var(--primary);"></i> DATOS DEL ADQUIRIENTE
                        </h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 11px; color: #334155;">
                            <div>
                                <div style="margin-bottom: 4px;"><i class="fa-solid fa-user" style="width: 14px; color: #94a3b8; margin-right: 4px;"></i><strong>Razón Social:</strong> <span style="color: #0f172a; font-weight: 500;">${customerName}</span></div>
                                <div><i class="fa-solid fa-id-card" style="width: 14px; color: #94a3b8; margin-right: 4px;"></i><strong>Identificación:</strong> <span>${customerNit}</span></div>
                            </div>
                            <div>
                                <div style="margin-bottom: 4px;"><i class="fa-solid fa-location-dot" style="width: 14px; color: #94a3b8; margin-right: 4px;"></i><strong>Dirección:</strong> <span>${customerAddress} (${customerCity})</span></div>
                                <div><i class="fa-solid fa-envelope" style="width: 14px; color: #94a3b8; margin-right: 4px;"></i><strong>Contacto:</strong> <span>${customerEmail} ${customerPhone !== 'S/D' ? ' / ' + customerPhone : ''}</span></div>
                            </div>
                        </div>
                    </div>

                    <!-- Products Table -->
                    <table class="data-table" style="font-size: 11px; width:100%; border-collapse: collapse; margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                        <thead>
                            <tr style="background-color: #0f172a; color: #ffffff;">
                                <th style="padding: 8px 12px; font-weight: 600; text-align: left; border: none;">#</th>
                                <th style="padding: 8px 12px; font-weight: 600; text-align: left; border: none;">SKU</th>
                                <th style="padding: 8px 12px; font-weight: 600; text-align: left; border: none;">PRODUCTO / DESCRIPCIÓN</th>
                                <th style="padding: 8px 12px; font-weight: 600; text-align: center; border: none;">CANT.</th>
                                <th style="padding: 8px 12px; font-weight: 600; text-align: right; border: none;">UNITARIO</th>
                                <th style="padding: 8px 12px; font-weight: 600; text-align: right; border: none;">SUBTOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                    </table>

                    <!-- Summary & QR/CUFE Section -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 16px; gap: 20px;">
                        <div style="flex: 1.2; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; background-color: #f8fafc; display: flex; align-items: center; gap: 12px;">
                            <div style="width: 60px; height: 60px; border: 1px solid #cbd5e1; border-radius: 6px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background-color: #ffffff; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                                <i class="fa-solid fa-qrcode" style="font-size: 20px; color: #334155; margin-bottom: 2px;"></i>
                                <span style="font-size: 6px; color: #475569; font-weight: 700; letter-spacing: 0.2px;">DIAN QR</span>
                            </div>
                            <div style="flex: 1; font-size: 10px; line-height: 1.3; color: #334155;">
                                <strong>Código CUFE / Firma Digital:</strong>
                                <div style="font-family: monospace; font-size: 8px; word-break: break-all; background-color: #ffffff; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; margin-top: 3px; color: #475569; line-height: 1.2;">
                                    ${data.header.dian_cufe || 'Transmisión Exitosa a la DIAN (Ambiente de Producción / Conforme)'}
                                </div>
                            </div>
                        </div>
                        <div style="flex: 0.8; min-width: 220px;">
                            <table style="width: 100%; font-size: 11px; border-collapse: collapse; color: #334155;">
                                <tr>
                                    <td style="padding: 4px 6px; color: #64748b;">Subtotal:</td>
                                    <td style="padding: 4px 6px; text-align: right; font-weight: 600; font-family: monospace; font-size: 12px;">${formatMoney(subtotalVal)}</td>
                                </tr>
                                ${totalDiscountVal > 0 ? `
                                <tr>
                                    <td style="padding: 4px 6px; color: #e11d48;">Descuento Comercial:</td>
                                    <td style="padding: 4px 6px; text-align: right; font-weight: 600; color: #e11d48; font-family: monospace; font-size: 12px;">-${formatMoney(totalDiscountVal)}</td>
                                </tr>
                                ` : ''}
                                <tr>
                                    <td style="padding: 4px 6px; color: #64748b;">Impuestos IVA (19%):</td>
                                    <td style="padding: 4px 6px; text-align: right; font-weight: 600; font-family: monospace; font-size: 12px;">${formatMoney(totalIvaVal)}</td>
                                </tr>
                                ${totalReteFte > 0 ? `
                                <tr>
                                    <td style="padding: 4px 6px; color: #e11d48;">ReteFuente Deducción:</td>
                                    <td style="padding: 4px 6px; text-align: right; font-weight: 600; color: #e11d48; font-family: monospace; font-size: 12px;">-${formatMoney(totalReteFte)}</td>
                                </tr>
                                ` : ''}
                                ${totalReteIca > 0 ? `
                                <tr>
                                    <td style="padding: 4px 6px; color: #e11d48;">ReteICA Deducción:</td>
                                    <td style="padding: 4px 6px; text-align: right; font-weight: 600; color: #e11d48; font-family: monospace; font-size: 12px;">-${formatMoney(totalReteIca)}</td>
                                </tr>
                                ` : ''}
                                <tr style="border-top: 2px solid #0f172a; font-weight: 700; font-size: 12px; background-color: rgba(79, 70, 229, 0.04);">
                                    <td style="padding: 8px 6px; color: #0f172a; border-bottom: 2px double #0f172a;">TOTAL FACTURA:</td>
                                    <td style="padding: 8px 6px; text-align: right; color: var(--primary); font-size: 13px; font-family: monospace; font-weight: 800; border-bottom: 2px double #0f172a;">${formatMoney(totalNetVal)}</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    <!-- Multinational Style Legal Footnote -->
                    <div style="border-top: 1px dashed #cbd5e1; margin-top: 20px; padding-top: 12px; font-size: 9px; color: #94a3b8; line-height: 1.4; text-align: justify;">
                        <div><strong>CLÁUSULAS LEGALES / TÍTULO VALOR:</strong> Esta factura de venta se asimila en todos sus efectos a una letra de cambio y constituye título valor conforme a la Ley 1231 de 2008 de la República de Colombia. El comprador declara haber recibido real y materialmente a entera satisfacción los productos y/o servicios descritos en este documento. En caso de mora se causarán intereses a la tasa máxima permitida por la Superintendencia Financiera.</div>
                        <div style="margin-top: 6px; display: flex; justify-content: space-between; font-weight: 600;">
                            <span>DIAN Proveedor Tecnológico Autorizado - SIMPLIX ERP Cloud Contable</span>
                            <span>¡Gracias por su compra!</span>
                        </div>
                    </div>
                </div>
                
                <div style="margin-top: 8px;">
                    <button class="btn btn-secondary btn-block" onclick="const ec = document.getElementById('modal-accounting-collapse'); ec.style.display = ec.style.display === 'none' ? 'block' : 'none';" style="font-size: 10px; padding: 4px 8px; margin-bottom: 6px;">
                        <i class="fa-solid fa-list"></i> Ver Asiento Contable (Partida Doble)
                    </button>
                    <div id="modal-accounting-collapse" style="display: none; border: 1px solid var(--border); border-radius: 6px; padding: 8px; background-color: var(--table-header); margin-top: 4px;">
                        <h4 style="font-size: 9px; margin-bottom: 4px; text-transform: uppercase; font-family: var(--font-heading);">Causación de Diario</h4>
                        <table class="data-table" style="font-size:9px; width:100%;">
                            <thead>
                                <tr>
                                    <th>Cuenta</th>
                                    <th>Nombre Cuenta</th>
                                    <th>Tercero</th>
                                    <th>C. Costo</th>
                                    <th style="text-align: right;">Débito</th>
                                    <th style="text-align: right;">Crédito</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${doubleEntryRows}
                                <tr style="font-weight:bold; border-top:1px solid var(--border);">
                                    <td colspan="4">TOTALES</td>
                                    <td style="text-align:right;">${formatMoney(totalDeb)}</td>
                                    <td style="text-align:right;">${formatMoney(totalCre)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            let totalDeb = 0;
            let totalCre = 0;
            let tableRowsHtml = '';
            
            data.details.forEach(d => {
                totalDeb += d.debito;
                totalCre += d.credito;
                
                let descText = d.cuenta_nombre;
                if (d.inventario_id) {
                    descText += ` <a href="#" onclick="const m = document.querySelector('.modal.active'); if(m) m.remove(); setTimeout(() => viewProductKardex(${d.inventario_id}), 150); return false;" style="color: var(--primary); text-decoration: underline; font-weight: 600; font-size: 10px; margin-left: 6px;"><i class="fa-solid fa-square-poll-vertical"></i> Kardex</a>`;
                }
                if (d.concepto_linea) {
                    descText += `<div style="font-size: 9px; color: var(--text-muted); font-style: italic; margin-top: 2px;">${d.concepto_linea}</div>`;
                }
                
                tableRowsHtml += `
                    <tr>
                        <td><strong>${d.cuenta_codigo}</strong></td>
                        <td>${descText}</td>
                        <td>${d.tercero_nombre || ''}</td>
                        <td>${d.centro_costo_codigo || ''}</td>
                        <td style="text-align:right;">${formatMoney(d.debito)}</td>
                        <td style="text-align:right;">${formatMoney(d.credito)}</td>
                    </tr>
                `;
            });

            detailsHtml = `
                <h3>Detalles del Asiento: ${data.header.tipo_documento}-${data.header.numero}</h3>
                <p style="font-size: 12px; margin-bottom: 6px;">Fecha: ${data.header.fecha} | Concepto: ${data.header.concepto}</p>
                <p style="font-size: 12px; margin-bottom: 6px;">Creado por: ${data.header.creado_por} | Total: ${formatMoney(data.header.total_documento)}</p>
                ${data.header.dian_cufe ? `<p style="font-size:10px; word-break:break-all; margin-bottom: 6px;"><strong>CUFE:</strong> ${data.header.dian_cufe}</p>` : ''}
                <hr style="margin:8px 0; border:0; border-top:1px solid var(--border);">
                <table class="data-table" style="font-size:11px; width:100%;">
                    <thead>
                        <tr>
                            <th>Cuenta</th>
                            <th>Nombre Cuenta</th>
                            <th>Tercero</th>
                            <th>C. Costo</th>
                            <th style="text-align: right;">Débito</th>
                            <th style="text-align: right;">Crédito</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHtml}
                        <tr style="font-weight:bold; border-top:1px solid var(--border);">
                            <td colspan="4">TOTALES</td>
                            <td style="text-align:right;">${formatMoney(totalDeb)}</td>
                            <td style="text-align:right;">${formatMoney(totalCre)}</td>
                        </tr>
                    </tbody>
                </table>
            `;
        }

        // Render in a custom prompt / dialog
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:800px;">
                <div class="modal-header">
                    <h3>Consulta de Documento Contable</h3>
                    <div>
                        ${isFV ? `
                            <button class="btn btn-secondary" onclick="openEmailInvoiceModal(${id}, '${escapedEmail}', '${prefijo}', '${numero}', ${totalVal})" style="margin-right:10px;"><i class="fa-solid fa-envelope"></i> Enviar por Correo</button>
                        ` : ''}
                        <button class="btn btn-secondary" onclick="printConsultedDocument(${id})" style="margin-right:10px;"><i class="fa-solid fa-print"></i> Imprimir</button>
                        <span class="close-btn" onclick="this.closest('.modal').remove()">&times;</span>
                    </div>
                </div>
                <div>${detailsHtml}</div>
            </div>
        `;
        document.body.appendChild(modal);

    } catch (e) {
        alert(e.message);
    }
}

function openEmailInvoiceModal(id, customerEmail, prefijo, numero, total) {
    const existing = document.getElementById('email-invoice-modal');
    if (existing) existing.remove();

    const toVal = customerEmail === 'S/D' || !customerEmail ? '' : customerEmail;
    const subjectVal = `Factura de Venta ${prefijo}-${numero}`;
    
    const isImportadora = activeTenant === 'importadora';
    const senderEmail = isImportadora ? 'importacioneskyh1@gmail.com' : 'contacto@clubsoldelvalle.com';
    const companyLabel = isImportadora ? 'IMPORTADORA KYH' : 'CLUB SOL DEL VALLE';

    let bodyText = `Estimado cliente,\n\nLe hacemos llegar la Factura de Venta ${prefijo}-${numero} por un valor de ${formatMoney(total)}.\n\nAtentamente,\n${companyLabel}\n${senderEmail}`;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'email-invoice-modal';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:500px; padding: 20px; border-radius: 12px; font-family: var(--font-body);">
            <div class="modal-header" style="border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 15px;">
                <h3 style="margin:0; color: var(--primary); font-family: var(--font-heading);"><i class="fa-solid fa-envelope"></i> Enviar Factura por Correo</h3>
                <span class="close-btn" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="form-group" style="margin-bottom: 12px; display: flex; flex-direction: column; align-items: stretch; text-align: left;">
                    <label style="display:block; font-weight:600; font-size:12px; margin-bottom:4px; color: var(--text-main);">Para (Correo del Cliente):</label>
                    <input type="email" id="email-invoice-to" value="${toVal}" placeholder="correo@cliente.com" style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border); font-size:13px; box-sizing:border-box; outline:none;">
                </div>
                <div class="form-group" style="margin-bottom: 12px; display: flex; flex-direction: column; align-items: stretch; text-align: left;">
                    <label style="display:block; font-weight:600; font-size:12px; margin-bottom:4px; color: var(--text-main);">Asunto:</label>
                    <input type="text" id="email-invoice-subject" value="${subjectVal}" style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border); font-size:13px; box-sizing:border-box; outline:none;">
                </div>
                <div class="form-group" style="margin-bottom: 15px; display: flex; flex-direction: column; align-items: stretch; text-align: left;">
                    <label style="display:block; font-weight:600; font-size:12px; margin-bottom:4px; color: var(--text-main);">Mensaje:</label>
                    <textarea id="email-invoice-body" rows="6" style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border); font-size:13px; font-family:var(--font-body); box-sizing:border-box; resize:vertical; outline:none;">${bodyText}</textarea>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <button type="button" id="btn-email-send-auto" class="btn btn-primary" onclick="sendInvoiceEmailAuto()" style="width:100%; font-size:13px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px;">
                        <i class="fa-solid fa-paper-plane"></i> Enviar Correo Automáticamente
                    </button>
                    
                    <div style="text-align: center; margin: 8px 0; font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 8px;">
                        ¿Problemas con el envío automático? Usar métodos manuales:
                    </div>
                    
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-secondary" onclick="sendInvoiceEmail('gmail')" style="flex:1; font-size:11px; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px;">
                            <i class="fa-brands fa-google"></i> Gmail Web
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="sendInvoiceEmail('mailto')" style="flex:1; font-size:11px; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px;">
                            <i class="fa-solid fa-envelope-open-text"></i> App Local
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    window.sendInvoiceEmailAuto = async function() {
        const to = document.getElementById('email-invoice-to').value.trim();
        const subject = document.getElementById('email-invoice-subject').value.trim();
        const body = document.getElementById('email-invoice-body').value.trim();
        const btn = document.getElementById('btn-email-send-auto');

        if (!to) {
            alert("Por favor, ingrese el correo electrónico del cliente.");
            return;
        }

        btn.disabled = true;
        const originalContent = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Enviando...`;

        try {
            const response = await fetch('https://repuestoscajica.com/upsseler/consolo/public/send_email.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    to: to,
                    subject: subject,
                    body: body,
                    from_name: companyLabel,
                    from_email: senderEmail,
                    token: 'Patucarro2026*'
                })
            });

            const resData = await response.json();
            if (resData.success) {
                alert("¡Correo enviado automáticamente con éxito!");
                modal.remove();
            } else {
                alert("Error al enviar correo: " + (resData.error || "Error desconocido"));
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        } catch (err) {
            console.error("Error sending automatic email:", err);
            alert("Error al enviar correo: " + err.message);
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    };

    window.sendInvoiceEmail = function(method) {
        const to = document.getElementById('email-invoice-to').value.trim();
        const subject = document.getElementById('email-invoice-subject').value.trim();
        const body = document.getElementById('email-invoice-body').value.trim();

        if (!to) {
            alert("Por favor, ingrese el correo electrónico del cliente.");
            return;
        }

        const encodedSubject = encodeURIComponent(subject);
        const encodedBody = encodeURIComponent(body);

        if (method === 'gmail') {
            const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodedSubject}&body=${encodedBody}`;
            window.open(gmailUrl, '_blank');
        } else {
            const mailtoUrl = `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`;
            window.location.href = mailtoUrl;
        }
        
        modal.remove();
    };
}

// EXPORT TABLE TO CSV/EXCEL FORMAT
function exportReportToExcel(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    
    // Rows
    for (let i = 0; i < table.rows.length; i++) {
        let row = table.rows[i];
        let rowData = [];
        for (let j = 0; j < row.cells.length; j++) {
            let val = row.cells[j].innerText.replace(/[\n\r]/g, "").trim();
            // Escape quote characters
            val = val.replace(/"/g, '""');
            // Wrap in quotes
            rowData.push('"' + val + '"');
        }
        csvContent += rowData.join(",") + "\r\n";
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${tableId}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// MODAL CONTROLS
function showModal(id) {
    document.getElementById(id).classList.add('active');
    // Hide all warning alerts
    const alerts = document.querySelectorAll('#t-doc-alert, #t-nombre-alert, #u-username-alert, #u-doc-alert');
    alerts.forEach(el => el.style.display = 'none');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function clearProductSearchFields(prefix) {
    const input = document.getElementById(`${prefix}-product-search`);
    const hidden = document.getElementById(`${prefix}-add-product`);
    const results = document.getElementById(`${prefix}-product-results`);
    if (input) input.value = '';
    if (hidden) hidden.value = '';
    if (results) results.style.display = 'none';
    if (input) input.focus();
}

async function lookupAndAddProductByCode(code, inputId) {
    if (window.lookupInProgress) return;
    window.lookupInProgress = true;
    try {
        const item = await fetchApi(`/${activeTenant}/inventario/by-code/${encodeURIComponent(code)}`);
        if (item && item.id) {
            if (inputId === 'fac-product-search') {
                document.getElementById('fac-add-product').value = item.id;
                document.getElementById('fac-add-price').value = item.precio_venta;
                addInvoiceItemRow();
            } else if (inputId === 'com-product-search') {
                document.getElementById('com-add-product').value = item.id;
                document.getElementById('com-add-cost').value = item.costo;
                addPurchaseItemRow();
            }
        } else {
            // Try to search general and add first match
            const resData = await fetchApi(`/${activeTenant}/inventario?page=1&limit=5&q=${encodeURIComponent(code)}`);
            const matches = resData.items || [];
            if (matches.length > 0) {
                const matchedItem = matches[0];
                if (inputId === 'fac-product-search') {
                    document.getElementById('fac-add-product').value = matchedItem.id;
                    document.getElementById('fac-add-price').value = matchedItem.precio_venta;
                    addInvoiceItemRow();
                } else if (inputId === 'com-product-search') {
                    document.getElementById('com-add-product').value = matchedItem.id;
                    document.getElementById('com-add-cost').value = matchedItem.costo;
                    addPurchaseItemRow();
                }
            } else {
                alert(`Producto con código o término "${code}" no encontrado.`);
            }
        }
    } catch (err) {
        console.error("Error looking up product by code:", err);
    } finally {
        window.lookupInProgress = false;
    }
}

// SEARCH AUTOCOMPLETE FOR CLIENTS/PRODUCTS/PUC
function setupAutocomplete(inputId, hiddenId, resultsId, type, onSelectCallback) {
    const input = typeof inputId === 'string' ? document.getElementById(inputId) : inputId;
    const hidden = typeof hiddenId === 'string' ? document.getElementById(hiddenId) : hiddenId;
    const resultsDiv = typeof resultsId === 'string' ? document.getElementById(resultsId) : resultsId;

    if (!input || !hidden || !resultsDiv) return;

    // Inject styles
    if (!document.getElementById('autocomplete-highlight-style')) {
        document.head.insertAdjacentHTML('beforeend', `
            <style id="autocomplete-highlight-style">
                .search-result-item.highlighted {
                    background-color: rgba(37, 99, 235, 0.1) !important;
                    color: var(--primary) !important;
                    cursor: pointer;
                }
            </style>
        `);
    }

    let activeIndex = -1;

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !resultsDiv.contains(e.target)) {
            resultsDiv.style.display = 'none';
            activeIndex = -1;
        }
    });

    input.addEventListener('input', async () => {
        const query = input.value.toLowerCase().trim();
        activeIndex = -1; // Reset active index on new query
        if (!query) {
            resultsDiv.style.display = 'none';
            hidden.value = '';
            if (onSelectCallback) onSelectCallback(null);
            return;
        }

        let matches = [];
        if (type === 'terceros') {
            matches = cacheTerceros.filter(t => {
                const idStr = t.identificacion ? String(t.identificacion).toLowerCase() : '';
                const nameStr = t.nombre ? String(t.nombre).toLowerCase() : '';
                const lastNameStr = t.apellidos ? String(t.apellidos).toLowerCase() : '';
                return idStr.includes(query) || nameStr.includes(query) || lastNameStr.includes(query);
            }).slice(0, 15);
        } else if (type === 'inventario') {
            try {
                const resData = await fetchApi(`/${activeTenant}/inventario?page=1&limit=15&q=${encodeURIComponent(query)}`);
                matches = resData.items || [];
                matches.forEach(item => {
                    autocompleteProductsCache.set(item.id, item);
                });
            } catch (err) {
                console.error("Error fetching autocomplete items:", err);
                matches = [];
            }
        } else if (type === 'puc') {
            const isNumericQuery = /^\d+$/.test(query);
            const directMatches = cachePuc.filter(p => {
                if (isNumericQuery) {
                    return p.codigo.startsWith(query);
                } else {
                    return p.codigo.includes(query) || p.nombre.toLowerCase().includes(query);
                }
            });
            
            directMatches.sort((a, b) => {
                if (!isNumericQuery) {
                    const aIsAdminExpense = a.codigo.startsWith('51');
                    const bIsAdminExpense = b.codigo.startsWith('51');
                    if (aIsAdminExpense && !bIsAdminExpense) return -1;
                    if (!aIsAdminExpense && bIsAdminExpense) return 1;

                    const aIsExpense = a.codigo.startsWith('5');
                    const bIsExpense = b.codigo.startsWith('5');
                    if (aIsExpense && !bIsExpense) return -1;
                    if (!aIsExpense && bIsExpense) return 1;
                }

                const aCodeStarts = a.codigo.startsWith(query);
                const bCodeStarts = b.codigo.startsWith(query);
                if (aCodeStarts && !bCodeStarts) return -1;
                if (!aCodeStarts && bCodeStarts) return 1;
                
                const aNameStarts = a.nombre.toLowerCase().startsWith(query);
                const bNameStarts = b.nombre.toLowerCase().startsWith(query);
                if (aNameStarts && !bNameStarts) return -1;
                if (!aNameStarts && bNameStarts) return 1;
                
                return a.codigo.localeCompare(b.codigo, undefined, { numeric: true });
            });
            
            let resultMatches = [];
            const addedCodes = new Set();
            
            directMatches.forEach(item => {
                if (!addedCodes.has(item.codigo)) {
                    resultMatches.push(item);
                    addedCodes.add(item.codigo);
                }
                
                if (query.length >= 4) {
                    const idx = cachePuc.findIndex(p => p.codigo === item.codigo);
                    if (idx !== -1) {
                        for (let i = 1; i <= 5; i++) {
                            if (idx + i < cachePuc.length) {
                                const nextItem = cachePuc[idx + i];
                                if (!addedCodes.has(nextItem.codigo)) {
                                    resultMatches.push(nextItem);
                                    addedCodes.add(nextItem.codigo);
                                }
                            }
                        }
                    }
                }
            });
            
            matches = resultMatches.slice(0, 500);
        }

        if (matches.length === 0) {
            resultsDiv.innerHTML = '<div class="search-result-item" style="color:var(--text-muted);">Sin resultados</div>';
            resultsDiv.style.display = 'block';
            return;
        }

        resultsDiv.innerHTML = '';
        matches.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.setAttribute('data-index', idx);
            
            if (type === 'terceros') {
                const fullname = item.nombre + (item.apellidos ? ' ' + item.apellidos : '');
                div.innerHTML = `<span class="item-code">${item.identificacion}</span> - ${fullname}`;
                div.addEventListener('click', () => {
                    input.value = `${item.identificacion} - ${fullname}`;
                    hidden.value = item.id;
                    resultsDiv.style.display = 'none';
                    activeIndex = -1;
                    if (onSelectCallback) onSelectCallback(item);
                });
            } else if (type === 'inventario') {
                const imgHtml = item.imagen_url 
                    ? `<img src="${item.imagen_url}" class="autocomplete-thumb" style="width:24px; height:24px; object-fit:cover; border-radius:4px; margin-right:8px; vertical-align:middle; border:1px solid var(--border-color);"/>` 
                    : `<div class="autocomplete-thumb" style="width:24px; height:24px; border-radius:4px; margin-right:8px; vertical-align:middle; background:var(--background-secondary); border:1px dashed var(--border-color); display:inline-flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:10px;"><i class="fa-solid fa-image"></i></div>`;
                
                div.innerHTML = `<div style="display:flex; align-items:center;">${imgHtml}<div style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><span class="item-code" style="font-weight:600;">${item.codigo}</span> - ${item.descripcion} <span style="color:var(--primary-color); font-weight:600;">(${formatMoney(item.precio_venta)})</span></div></div>`;
                
                if (!item.imagen_url) {
                    fetchApi(`/${activeTenant}/inventario/ensure-image`, {
                        method: 'POST',
                        body: { id: item.id }
                    }).then(res => {
                        if (res && res.imagen_url) {
                            item.imagen_url = res.imagen_url;
                            const cached = cacheInventario.find(p => p.id === item.id) || autocompleteProductsCache.get(item.id);
                            if (cached) cached.imagen_url = res.imagen_url;
                            renderInvoiceItems();
                            renderPurchaseItems();
                            const imgTag = div.querySelector('.autocomplete-thumb');
                            if (imgTag) {
                                imgTag.outerHTML = `<img src="${res.imagen_url}" class="autocomplete-thumb" style="width:24px; height:24px; object-fit:cover; border-radius:4px; margin-right:8px; vertical-align:middle; border:1px solid var(--border-color);"/>`;
                            }
                        }
                    }).catch(err => console.error("Error ensuring product image:", err));
                }

                div.addEventListener('click', () => {
                    input.value = `${item.codigo} - ${item.descripcion}`;
                    hidden.value = item.id;
                    resultsDiv.style.display = 'none';
                    activeIndex = -1;
                    
                    if (inputId === 'fac-product-search') {
                        document.getElementById('fac-add-price').value = item.precio_venta;
                    } else if (inputId === 'com-product-search') {
                        document.getElementById('com-add-cost').value = item.costo;
                    }
                    if (onSelectCallback) onSelectCallback(item);
                });
            } else if (type === 'puc') {
                div.innerHTML = `<span class="item-code">${item.codigo}</span> - ${item.nombre}`;
                div.addEventListener('click', () => {
                    input.value = `${item.codigo} - ${item.nombre}`;
                    hidden.value = item.codigo;
                    resultsDiv.style.display = 'none';
                    activeIndex = -1;
                    if (onSelectCallback) onSelectCallback(item);
                });
            }
            resultsDiv.appendChild(div);
        });
        resultsDiv.style.display = 'block';
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const isDropdownVisible = resultsDiv.style.display === 'block';
            const items = isDropdownVisible ? resultsDiv.querySelectorAll('.search-result-item') : [];
            
            if (isDropdownVisible && items.length > 0) {
                const indexToSelect = activeIndex >= 0 ? activeIndex : 0;
                if (items[indexToSelect]) {
                    items[indexToSelect].click();
                    
                    if (inputId === 'fac-product-search') {
                        addInvoiceItemRow();
                    } else if (inputId === 'com-product-search') {
                        addPurchaseItemRow();
                    }
                }
            } else {
                const val = input.value.trim();
                if (val) {
                    if (hidden.value) {
                        if (inputId === 'fac-product-search') {
                            addInvoiceItemRow();
                        } else if (inputId === 'com-product-search') {
                            addPurchaseItemRow();
                        }
                    } else {
                        lookupAndAddProductByCode(val, inputId);
                    }
                }
            }
            activeIndex = -1;
            return;
        }

        if (resultsDiv.style.display !== 'block') return;
        const items = resultsDiv.querySelectorAll('.search-result-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (activeIndex >= 0 && items[activeIndex]) {
                items[activeIndex].classList.remove('highlighted');
            }
            activeIndex = (activeIndex + 1) % items.length;
            items[activeIndex].classList.add('highlighted');
            items[activeIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeIndex >= 0 && items[activeIndex]) {
                items[activeIndex].classList.remove('highlighted');
            }
            activeIndex = (activeIndex - 1 + items.length) % items.length;
            items[activeIndex].classList.add('highlighted');
            items[activeIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Escape') {
            resultsDiv.style.display = 'none';
            activeIndex = -1;
        }
    });

    input.addEventListener('change', () => {
        if (!input.value.trim()) {
            hidden.value = '';
            if (onSelectCallback) onSelectCallback(null);
        }
    });
}

let currentSmartSearchType = 'cliente'; // 'cliente' or 'producto'

function openSmartSearch(type) {
    currentSmartSearchType = type;
    const titleEl = document.getElementById('smart-search-title');
    const inputEl = document.getElementById('smart-search-input');
    const resultsContainer = document.getElementById('smart-search-results-container');
    const noResultsEl = document.getElementById('smart-search-no-results');
    const createBtn = document.getElementById('smart-search-create-btn');

    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'none';
    noResultsEl.style.display = 'none';
    inputEl.value = '';

    if (type === 'cliente') {
        titleEl.innerText = 'Búsqueda Inteligente de Clientes';
        inputEl.placeholder = 'Buscar por NIT, Documento o Nombre...';
        createBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Crear Cliente';
    } else {
        titleEl.innerText = 'Búsqueda Inteligente de Productos';
        inputEl.placeholder = 'Buscar por Código, SKU o Descripción...';
        createBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Crear Producto';
    }

    showModal('smart-search-modal');
    setTimeout(() => inputEl.focus(), 150);
}

async function triggerSmartSearch() {
    const query = document.getElementById('smart-search-input').value.toLowerCase().trim();
    const resultsContainer = document.getElementById('smart-search-results-container');
    const noResultsEl = document.getElementById('smart-search-no-results');
    
    if (!query) {
        resultsContainer.innerHTML = '';
        resultsContainer.style.display = 'none';
        noResultsEl.style.display = 'none';
        return;
    }

    let matches = [];
    if (currentSmartSearchType === 'cliente') {
        matches = cacheTerceros.filter(t => 
            (t.identificacion && t.identificacion.toLowerCase().includes(query)) ||
            (t.nombre && t.nombre.toLowerCase().includes(query)) ||
            (t.apellidos && t.apellidos.toLowerCase().includes(query))
        );
        matches.sort((a, b) => {
            const nameA = (a.nombre + (a.apellidos ? ' ' + a.apellidos : '')).toLowerCase();
            const nameB = (b.nombre + (b.apellidos ? ' ' + b.apellidos : '')).toLowerCase();
            return nameA.localeCompare(nameB);
        });
    } else if (currentSmartSearchType === 'producto') {
        try {
            const resData = await fetchApi(`/${activeTenant}/inventario?page=1&limit=50&q=${encodeURIComponent(query)}`);
            matches = resData.items || [];
            matches.forEach(item => {
                autocompleteProductsCache.set(item.id, item);
            });
            matches.sort((a, b) => {
                const descA = (a.descripcion || '').toLowerCase();
                const descB = (b.descripcion || '').toLowerCase();
                return descA.localeCompare(descB);
            });
        } catch (err) {
            console.error("Error in smart product search:", err);
            matches = [];
        }
    }

    renderSmartSearchResults(matches);
}

function renderSmartSearchResults(matches) {
    const resultsContainer = document.getElementById('smart-search-results-container');
    const noResultsEl = document.getElementById('smart-search-no-results');

    resultsContainer.innerHTML = '';

    if (matches.length === 0) {
        resultsContainer.style.display = 'none';
        noResultsEl.style.display = 'block';
        return;
    }

    noResultsEl.style.display = 'none';
    resultsContainer.style.display = 'block';

    matches.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.style.padding = '10px 12px';
        itemEl.style.borderBottom = '1px solid var(--border)';
        itemEl.style.cursor = 'pointer';
        itemEl.style.display = 'flex';
        itemEl.style.justifyContent = 'space-between';
        itemEl.style.alignItems = 'center';
        itemEl.style.transition = 'background 0.2s';
        
        itemEl.addEventListener('mouseenter', () => {
            itemEl.style.background = 'var(--bg-app)';
        });
        itemEl.addEventListener('mouseleave', () => {
            itemEl.style.background = 'transparent';
        });

        if (currentSmartSearchType === 'cliente') {
            const fullname = item.nombre + (item.apellidos ? ' ' + item.apellidos : '');
            itemEl.innerHTML = `
                <div>
                    <strong style="color: var(--text-main); font-size: 14px;">${fullname}</strong>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">NIT/Doc: ${item.identificacion}</div>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 11px; padding: 2px 6px; background: rgba(37, 99, 235, 0.1); color: var(--accent); border-radius: 4px;">Cliente</span>
                </div>
            `;
            itemEl.addEventListener('click', () => {
                selectSmartSearchResult(item);
            });
        } else {
            const imageHtml = item.imagen_url 
                ? `<img src="${item.imagen_url}" style="width:36px; height:36px; object-fit:cover; border-radius:4px; margin-right:10px; border:1px solid var(--border);"/>` 
                : `<div style="width:36px; height:36px; border-radius:4px; margin-right:10px; background:var(--bg-app); border:1px dashed var(--border); display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:12px;"><i class="fa-solid fa-image"></i></div>`;
            
            itemEl.innerHTML = `
                <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
                    ${imageHtml}
                    <div style="flex: 1; min-width: 0;">
                        <strong style="color: var(--text-main); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${item.descripcion}</strong>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                            SKU: ${item.codigo} | Stock: <span style="font-weight: 600; color: ${item.stock <= 0 ? 'red' : 'green'};">${item.stock}</span>
                        </div>
                    </div>
                </div>
                <div style="text-align: right; margin-left: 10px; flex-shrink: 0;">
                    <div style="font-weight: 600; color: var(--primary); font-size: 14px;">${formatMoney(item.precio_venta)}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">con IVA</div>
                </div>
            `;
            itemEl.addEventListener('click', () => {
                selectSmartSearchResult(item);
            });
        }

        resultsContainer.appendChild(itemEl);
    });
}

function selectSmartSearchResult(item) {
    if (currentSmartSearchType === 'cliente') {
        const fullname = item.nombre + (item.apellidos ? ' ' + item.apellidos : '');
        const searchInput = document.getElementById('fac-cliente-search');
        const hiddenInput = document.getElementById('fac-cliente');
        
        searchInput.value = `${item.identificacion} - ${fullname}`;
        hiddenInput.value = item.id;
        
        updateInvoiceTotals();
    } else {
        const searchInput = document.getElementById('fac-product-search');
        const hiddenInput = document.getElementById('fac-add-product');
        
        searchInput.value = `${item.codigo} - ${item.descripcion}`;
        hiddenInput.value = item.id;
        
        document.getElementById('fac-add-price').value = Math.round(item.precio_venta);
    }
    
    closeModal('smart-search-modal');
}

function goToCreateEntity() {
    closeModal('smart-search-modal');
    if (currentSmartSearchType === 'cliente') {
        showModal('tercero-modal');
    } else {
        showModal('inventario-modal');
    }
}

function setupAutocompletesAll() {
    const smartSearchInput = document.getElementById('smart-search-input');
    if (smartSearchInput) {
        let debounceTimer;
        smartSearchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(triggerSmartSearch, 300);
        });
        smartSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                triggerSmartSearch();
            }
        });
    }

    setupAutocomplete('fac-cliente-search', 'fac-cliente', 'fac-cliente-results', 'terceros', () => updateInvoiceTotals());
    setupAutocomplete('fac-product-search', 'fac-add-product', 'fac-product-results', 'inventario');
    setupAutocomplete('com-proveedor-search', 'com-proveedor', 'com-proveedor-results', 'terceros', () => updatePurchaseContabilizacion());
    setupAutocomplete('com-product-search', 'com-add-product', 'com-product-results', 'inventario');
    setupAutocomplete('rc-cliente-search', 'rc-cliente', 'rc-cliente-results', 'terceros');
    setupAutocomplete('ce-beneficiario-search', 'ce-beneficiario', 'ce-beneficiario-results', 'terceros');

    // Autocompletes para nuevos formularios
    setupAutocomplete('ce-doc-beneficiario-search', 'ce-doc-beneficiario', 'ce-doc-beneficiario-results', 'terceros', () => updateCeDocContabilizacion());
    setupAutocomplete('ce-doc-cuenta-gasto-search', 'ce-doc-cuenta-gasto', 'ce-doc-cuenta-gasto-results', 'puc', () => updateCeDocContabilizacion());
    
    setupAutocomplete('rc-doc-cliente-search', 'rc-doc-cliente', 'rc-doc-cliente-results', 'terceros', () => updateRcDocContabilizacion());
    setupAutocomplete('rc-doc-cuenta-ingreso-search', 'rc-doc-cuenta-ingreso', 'rc-doc-cuenta-ingreso-results', 'puc', () => updateRcDocContabilizacion());
    
    setupAutocomplete('nm-doc-empleado-search', 'nm-doc-empleado', 'nm-doc-empleado-results', 'terceros', (employee) => {
        if (employee && employee.sueldo) {
            document.getElementById('nm-doc-sueldo').value = employee.sueldo;
        }
        updateNmDocContabilizacion();
    });
    
    setupAutocomplete('fil-producto-search', 'fil-producto', 'fil-producto-results', 'inventario', () => filterDocuments());

    // POS & Reservas
    setupAutocomplete('pos-cliente-search', 'pos-cliente', 'pos-cliente-results', 'terceros');
    setupAutocomplete('res-cliente-search', 'res-cliente', 'res-cliente-results', 'terceros');

    // Autocomplete for register user modal
    setupAutocomplete('u-tercero-search', 'u-tercero-id', 'u-tercero-results', 'terceros', (tercero) => {
        if (!tercero) return;
        document.getElementById('u-nombre').value = tercero.nombre || '';
        document.getElementById('u-apellidos').value = tercero.apellidos || '';
        document.getElementById('u-tipo-doc').value = tercero.tipo_identificacion || 'CC';
        document.getElementById('u-doc').value = tercero.identificacion || '';
        document.getElementById('u-email').value = tercero.email || '';
        document.getElementById('u-telefono').value = tercero.telefono || '';
        document.getElementById('u-direccion').value = tercero.direccion || '';
        document.getElementById('u-ciudad').value = tercero.ciudad || 'Bogotá';
        document.getElementById('u-sueldo').value = tercero.sueldo || 1300000;
        
        // Auto-generate suggested username
        if (tercero.nombre) {
            const cleanName = tercero.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
            const cleanLastName = (tercero.apellidos || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").split(' ')[0];
            if (cleanLastName) {
                document.getElementById('u-username').value = `${cleanName.split(' ')[0]}.${cleanLastName}`;
            } else {
                document.getElementById('u-username').value = cleanName.split(' ')[0];
            }
        }
    });
}

function clearAutocompleteFields() {
    const searchInputs = [
        'fac-cliente-search', 'fac-product-search', 'com-proveedor-search', 'com-product-search', 
        'rc-cliente-search', 'ce-beneficiario-search',
        'ce-doc-beneficiario-search', 'ce-doc-cuenta-gasto-search',
        'rc-doc-cliente-search', 'rc-doc-cuenta-ingreso-search',
        'nm-doc-empleado-search', 'fil-producto-search',
        'pos-cliente-search', 'res-cliente-search', 'u-tercero-search'
    ];
    searchInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const hiddenInputs = [
        'fac-cliente', 'fac-add-product', 'com-proveedor', 'com-add-product', 
        'rc-cliente', 'ce-beneficiario',
        'ce-doc-beneficiario', 'ce-doc-cuenta-gasto',
        'rc-doc-cliente', 'rc-doc-cuenta-ingreso',
        'nm-doc-empleado', 'fil-producto',
        'pos-cliente', 'res-cliente'
    ];
    hiddenInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

// SUBMIT RECIBO DE CAJA (RC)
async function submitRecibo(e) {
    e.preventDefault();
    const cliente_id = parseInt(document.getElementById('rc-cliente').value);
    const fecha = document.getElementById('rc-fecha').value;
    const cuenta = document.getElementById('rc-cuenta').value;
    const valor = parseFloat(document.getElementById('rc-valor').value) || 0;
    const concepto = document.getElementById('rc-concepto').value.trim();
    const statusMsg = document.getElementById('rc-status-msg');

    if (!cliente_id) {
        alert('Por favor, selecciona un cliente válido usando el buscador.');
        return;
    }

    let metodo_pago = 'efectivo';
    if (cuenta === '11100508') metodo_pago = 'bancolombia';
    else if (cuenta === '11100510') metodo_pago = 'nequi';

    statusMsg.innerHTML = '<span style="color:var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Registrando recibo...</span>';

    try {
        const body = {
            cliente_id,
            fecha,
            concepto,
            valor,
            metodo_pago,
            usuario: 'admin'
        };

        const result = await fetchApi(`/${activeTenant}/recibo`, { method: 'POST', body });
        statusMsg.innerHTML = `<span style="color:green; font-weight:bold;"><i class="fa-solid fa-circle-check"></i> Recibo de Caja RC-${result.numero} emitido y causado con éxito.</span>`;
        document.getElementById('recibo-form').reset();
        document.getElementById('rc-fecha').value = new Date().toISOString().split('T')[0];
        clearAutocompleteFields();
        loadCurrentTenantData();
    } catch (err) {
        statusMsg.innerHTML = `<span style="color:red; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${err.message}</span>`;
    }
}

// SUBMIT COMPROBANTE DE EGRESO (CE) EN EL TAB DE TESORERIA
async function submitEgreso(e) {
    e.preventDefault();
    const tercero_id = parseInt(document.getElementById('ce-beneficiario').value);
    const fecha = document.getElementById('ce-fecha').value;
    const cuenta = document.getElementById('ce-cuenta').value;
    const valor = parseFloat(document.getElementById('ce-valor').value) || 0;
    const concepto = document.getElementById('ce-concepto').value.trim();
    const statusMsg = document.getElementById('ce-status-msg');

    if (!tercero_id) {
        alert('Por favor, selecciona un beneficiario válido usando el buscador.');
        return;
    }

    let metodo_pago = 'efectivo';
    if (cuenta === '11100508') metodo_pago = 'bancolombia';
    else if (cuenta === '11100510') metodo_pago = 'nequi';

    statusMsg.innerHTML = '<span style="color:var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Registrando egreso...</span>';

    try {
        const body = {
            tercero_id,
            fecha,
            concepto: `Egreso Caja: ${concepto}`,
            valor,
            cuenta_gasto: '2205',
            metodo_pago,
            usuario: 'admin'
        };

        const result = await fetchApi(`/${activeTenant}/egreso`, { method: 'POST', body });
        statusMsg.innerHTML = `<span style="color:green; font-weight:bold;"><i class="fa-solid fa-circle-check"></i> Comprobante de Egreso CE-${result.numero} emitido y causado con éxito.</span>`;
        document.getElementById('egreso-form').reset();
        document.getElementById('ce-fecha').value = new Date().toISOString().split('T')[0];
        clearAutocompleteFields();
        loadCurrentTenantData();
    } catch (err) {
        statusMsg.innerHTML = `<span style="color:red; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${err.message}</span>`;
    }
}

// ==========================================================================
// SECCIÓN: COMPROBANTE DE EGRESO DEDICADO (CE)
// ==========================================================================
function prepareCeDocView() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('ce-doc-fecha').value = today;
    document.getElementById('ce-doc-form').reset();
    document.getElementById('ce-doc-fecha').value = today;
    document.getElementById('ce-doc-cuenta-gasto').value = '2205'; // default
    document.getElementById('ce-doc-cuenta-gasto-search').value = '2205 - PROVEEDORES NACIONALES';
    clearAutocompleteFields();
    updateCeDocContabilizacion();
}

function updateCeDocContabilizacion() {
    const val = parseFloat(document.getElementById('ce-doc-valor').value) || 0;
    const concept = document.getElementById('ce-doc-concepto').value.trim() || 'Egreso por pago/gasto';
    const payAccountCode = document.getElementById('ce-doc-cuenta-pago').value;
    const expenseAccountCode = document.getElementById('ce-doc-cuenta-gasto').value || '2205';
    
    const payAcc = cachePuc.find(p => p.codigo === payAccountCode);
    const expAcc = cachePuc.find(p => p.codigo === expenseAccountCode);
    
    const payName = payAcc ? payAcc.nombre : 'Caja/Banco';
    const expName = expAcc ? expAcc.nombre : 'Gasto/Pasivo';
    
    const tbody = document.querySelector('#ce-doc-accounting-table tbody');
    tbody.innerHTML = '';
    
    if (val === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Completa el formulario</td></tr>';
        return;
    }
    
    // Linea 1: Débito a la cuenta de Gasto o Proveedores
    const tr1 = document.createElement('tr');
    tr1.innerHTML = `
        <td><strong>${expenseAccountCode}</strong> - ${expName}</td>
        <td>Beneficiario</td>
        <td class="col-amount col-debit">${formatMoney(val)}</td>
        <td class="col-amount col-credit"></td>
    `;
    tbody.appendChild(tr1);
    
    // Linea 2: Crédito a la cuenta de Caja o Banco
    const tr2 = document.createElement('tr');
    tr2.innerHTML = `
        <td><strong>${payAccountCode}</strong> - ${payName}</td>
        <td>Beneficiario</td>
        <td class="col-amount col-debit"></td>
        <td class="col-amount col-credit">${formatMoney(val)}</td>
    `;
    tbody.appendChild(tr2);
    
    // Totales de Partida Doble
    const trTot = document.createElement('tr');
    trTot.className = 'totals-row';
    trTot.innerHTML = `
        <td colspan="2">SUMAS IGUALES</td>
        <td class="col-amount col-debit">${formatMoney(val)}</td>
        <td class="col-amount col-credit">${formatMoney(val)}</td>
    `;
    tbody.appendChild(trTot);
}

async function submitCeDoc(e) {
    e.preventDefault();
    const beneficiaryId = parseInt(document.getElementById('ce-doc-beneficiario').value);
    const fecha = document.getElementById('ce-doc-fecha').value;
    const payAccount = document.getElementById('ce-doc-cuenta-pago').value;
    const expenseAccount = document.getElementById('ce-doc-cuenta-gasto').value;
    const valor = parseFloat(document.getElementById('ce-doc-valor').value) || 0;
    const concepto = document.getElementById('ce-doc-concepto').value.trim();
    
    if (!beneficiaryId) {
        alert('Por favor, selecciona un beneficiario usando el buscador.');
        return;
    }
    if (!expenseAccount) {
        alert('Por favor, selecciona una cuenta contable de gasto/pasivo usando el buscador.');
        return;
    }
    
    let metodo_pago = 'efectivo';
    if (payAccount === '11100508') metodo_pago = 'bancolombia';
    else if (payAccount === '11100510') metodo_pago = 'nequi';
    
    const body = {
        tercero_id: beneficiaryId,
        fecha,
        concepto: `CE: ${concepto} - Tercero: ${document.getElementById('ce-doc-beneficiario-search').value.split(' - ')[1]}`,
        valor,
        cuenta_gasto: expenseAccount,
        metodo_pago,
        usuario: currentUserId
    };
    
    try {
        const result = await fetchApi(`/${activeTenant}/egreso`, { method: 'POST', body });
        alert(`Comprobante de Egreso CE-${result.numero} emitido y causado con éxito.`);
        prepareCeDocView();
        loadNextDocumentNumbers();
        changeView('documentos-hub');
    } catch(err) {
        alert('Error al registrar egreso: ' + err.message);
    }
}

// ==========================================================================
// SECCIÓN: RECIBO DE CAJA DEDICADO (RC)
// ==========================================================================
function prepareRcDocView() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('rc-doc-fecha').value = today;
    document.getElementById('rc-doc-form').reset();
    document.getElementById('rc-doc-fecha').value = today;
    document.getElementById('rc-doc-cuenta-ingreso').value = '130505'; // default national customers
    document.getElementById('rc-doc-cuenta-ingreso-search').value = '130505 - CLIENTES NACIONALES';
    clearAutocompleteFields();
    updateRcDocContabilizacion();
}

function updateRcDocContabilizacion() {
    const val = parseFloat(document.getElementById('rc-doc-valor').value) || 0;
    const concept = document.getElementById('rc-doc-concepto').value.trim() || 'Recibo de Caja';
    const destAccountCode = document.getElementById('rc-doc-cuenta-destino').value;
    const incomeAccountCode = document.getElementById('rc-doc-cuenta-ingreso').value || '130505';
    
    const destAcc = cachePuc.find(p => p.codigo === destAccountCode);
    const incAcc = cachePuc.find(p => p.codigo === incomeAccountCode);
    
    const destName = destAcc ? destAcc.nombre : 'Caja/Banco';
    const incName = incAcc ? incAcc.nombre : 'Clientes/Cartera';
    
    const tbody = document.querySelector('#rc-doc-accounting-table tbody');
    tbody.innerHTML = '';
    
    if (val === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Completa el formulario</td></tr>';
        return;
    }
    
    // Linea 1: Débito a Caja/Bancos
    const tr1 = document.createElement('tr');
    tr1.innerHTML = `
        <td><strong>${destAccountCode}</strong> - ${destName}</td>
        <td>Cliente</td>
        <td class="col-amount col-debit">${formatMoney(val)}</td>
        <td class="col-amount col-credit"></td>
    `;
    tbody.appendChild(tr1);
    
    // Linea 2: Crédito a Deudores/Cartera o Ingreso
    const tr2 = document.createElement('tr');
    tr2.innerHTML = `
        <td><strong>${incomeAccountCode}</strong> - ${incName}</td>
        <td>Cliente</td>
        <td class="col-amount col-debit"></td>
        <td class="col-amount col-credit">${formatMoney(val)}</td>
    `;
    tbody.appendChild(tr2);
    
    // Totales
    const trTot = document.createElement('tr');
    trTot.className = 'totals-row';
    trTot.innerHTML = `
        <td colspan="2">SUMAS IGUALES</td>
        <td class="col-amount col-debit">${formatMoney(val)}</td>
        <td class="col-amount col-credit">${formatMoney(val)}</td>
    `;
    tbody.appendChild(trTot);
}

async function submitRcDoc(e) {
    e.preventDefault();
    const clienteId = parseInt(document.getElementById('rc-doc-cliente').value);
    const fecha = document.getElementById('rc-doc-fecha').value;
    const destAccount = document.getElementById('rc-doc-cuenta-destino').value;
    const incomeAccount = document.getElementById('rc-doc-cuenta-ingreso').value;
    const valor = parseFloat(document.getElementById('rc-doc-valor').value) || 0;
    const concepto = document.getElementById('rc-doc-concepto').value.trim();
    
    if (!clienteId) {
        alert('Por favor, selecciona un cliente usando el buscador.');
        return;
    }
    
    let metodo_pago = 'efectivo';
    if (destAccount === '11100508') metodo_pago = 'bancolombia';
    else if (destAccount === '11100510') metodo_pago = 'nequi';
    
    const body = {
        cliente_id: clienteId,
        fecha,
        concepto: `RC: ${concepto} - Tercero: ${document.getElementById('rc-doc-cliente-search').value.split(' - ')[1]}`,
        valor,
        cuenta_recibo: incomeAccount,
        metodo_pago,
        usuario: currentUserId
    };
    
    try {
        const result = await fetchApi(`/${activeTenant}/recibo`, { method: 'POST', body });
        alert(`Recibo de Caja RC-${result.numero} emitido y causado con éxito.`);
        prepareRcDocView();
        loadNextDocumentNumbers();
        changeView('documentos-hub');
    } catch(err) {
        alert('Error al registrar recibo: ' + err.message);
    }
}

// ==========================================================================
// SECCIÓN: LIQUIDACIÓN DE NÓMINA DEDICADO (NM)
// ==========================================================================
function prepareNmDocView() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('nm-doc-fecha').value = today;
    document.getElementById('nm-doc-form').reset();
    document.getElementById('nm-doc-fecha').value = today;
    clearAutocompleteFields();
    updateNmDocContabilizacion();
}

function updateNmDocContabilizacion() {
    const sueldo = parseFloat(document.getElementById('nm-doc-sueldo').value) || 0;
    const extras = parseFloat(document.getElementById('nm-doc-extras').value) || 0;
    
    // Cálculos de deducción obligatorios salud y pensión (4% cada uno)
    const salud = Math.round(sueldo * 0.04);
    const pension = Math.round(sueldo * 0.04);
    
    document.getElementById('nm-doc-salud').value = salud;
    document.getElementById('nm-doc-pension').value = pension;
    
    const devengado = sueldo + extras;
    const deducciones = salud + pension;
    const neto = devengado - deducciones;
    
    document.getElementById('nm-tot-devengado').innerText = formatMoney(devengado);
    document.getElementById('nm-tot-deducciones').innerText = formatMoney(deducciones);
    document.getElementById('nm-tot-neto').innerText = formatMoney(neto);
    
    const payMethod = document.getElementById('nm-doc-pago').value;
    let payAccountCode = '11050501'; // Default Caja
    if (payMethod === 'bancolombia') payAccountCode = '11100508';
    else if (payMethod === 'nequi') payAccountCode = '11100510';
    
    const destAcc = cachePuc.find(p => p.codigo === payAccountCode);
    const destName = destAcc ? destAcc.nombre : 'Caja/Banco';
    
    const tbody = document.querySelector('#nm-doc-accounting-table tbody');
    tbody.innerHTML = '';
    
    if (devengado === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Completa el formulario</td></tr>';
        return;
    }
    
    // Linea 1: Débito a Gastos de Personal (510506)
    const tr1 = document.createElement('tr');
    tr1.innerHTML = `
        <td><strong>510506</strong> - SUELDOS</td>
        <td>Empleado</td>
        <td class="col-amount col-debit">${formatMoney(devengado)}</td>
        <td class="col-amount col-credit"></td>
    `;
    tbody.appendChild(tr1);
    
    // Linea 2: Crédito a Aportes Salud Pasivo (237005)
    if (salud > 0) {
        const tr2 = document.createElement('tr');
        tr2.innerHTML = `
            <td><strong>237005</strong> - SALUD POR PAGAR</td>
            <td>Empleado</td>
            <td class="col-amount col-debit"></td>
            <td class="col-amount col-credit">${formatMoney(salud)}</td>
        `;
        tbody.appendChild(tr2);
    }
    
    // Linea 3: Crédito a Aportes Pensión Pasivo (238030)
    if (pension > 0) {
        const tr3 = document.createElement('tr');
        tr3.innerHTML = `
            <td><strong>238030</strong> - PENSIONES POR PAGAR</td>
            <td>Empleado</td>
            <td class="col-amount col-debit"></td>
            <td class="col-amount col-credit">${formatMoney(pension)}</td>
        `;
        tbody.appendChild(tr3);
    }
    
    // Linea 4: Crédito al Medio de Pago (Neto)
    const tr4 = document.createElement('tr');
    tr4.innerHTML = `
        <td><strong>${payAccountCode}</strong> - ${destName}</td>
        <td>Empleado</td>
        <td class="col-amount col-debit"></td>
        <td class="col-amount col-credit">${formatMoney(neto)}</td>
    `;
    tbody.appendChild(tr4);
    
    // Totales
    const trTot = document.createElement('tr');
    trTot.className = 'totals-row';
    trTot.innerHTML = `
        <td colspan="2">SUMAS IGUALES</td>
        <td class="col-amount col-debit">${formatMoney(devengado)}</td>
        <td class="col-amount col-credit">${formatMoney(devengado)}</td>
    `;
    tbody.appendChild(trTot);
}

async function submitNmDoc(e) {
    e.preventDefault();
    const empleadoId = parseInt(document.getElementById('nm-doc-empleado').value);
    const fecha = document.getElementById('nm-doc-fecha').value;
    const sueldo = parseFloat(document.getElementById('nm-doc-sueldo').value) || 0;
    const extras = parseFloat(document.getElementById('nm-doc-extras').value) || 0;
    const salud = parseFloat(document.getElementById('nm-doc-salud').value) || 0;
    const pension = parseFloat(document.getElementById('nm-doc-pension').value) || 0;
    const pago = document.getElementById('nm-doc-pago').value;
    const concepto = document.getElementById('nm-doc-concepto').value.trim();
    
    if (!empleadoId) {
        alert('Por favor, selecciona un empleado usando el buscador.');
        return;
    }
    
    const body = {
        empleado_id: empleadoId,
        fecha,
        concepto: `NM: ${concepto} - Empleado: ${document.getElementById('nm-doc-empleado-search').value.split(' - ')[1]}`,
        sueldo_basico: sueldo,
        horas_extras: extras,
        deduccion_salud: salud,
        deduccion_pension: pension,
        metodo_pago: pago,
        usuario: currentUserId
    };
    
    try {
        const result = await fetchApi(`/${activeTenant}/nomina`, { method: 'POST', body });
        alert(`Liquidación de Nómina NM-${result.numero} guardada y causada con éxito.`);
        prepareNmDocView();
        loadNextDocumentNumbers();
        changeView('documentos-hub');
    } catch(err) {
        alert('Error al causar nómina: ' + err.message);
    }
}

// ==========================================================================
// SECCIÓN: NOTA DE CONTABILIDAD GRID (NC)
// ==========================================================================
let ncRows = [];

// Motor IA Local para clasificación de conceptos de gasto administrativo (Cuenta que inicia por 5)
function mapConceptToExpenseAccount(conceptText) {
    if (!conceptText) return null;
    const text = conceptText.toLowerCase().trim();
    
    // IA Mapping Rules (Keywords -> Account Search Terms)
    const rules = [
        {
            codePrefix: '11050501',
            nameKeyword: 'caja',
            keywords: ['caja', 'caja general', 'efectivo', 'pagado en efectivo', 'pago efectivo', 'caja principal']
        },
        {
            codePrefix: '110510',
            nameKeyword: 'menores',
            keywords: ['caja menor', 'cajas menores', 'reembolso caja menor']
        },
        {
            codePrefix: '11100510',
            nameKeyword: 'nequi',
            keywords: ['nequi', 'pago nequi', 'transferencia nequi']
        },
        {
            codePrefix: '11100512',
            nameKeyword: 'pago',
            keywords: ['mercado pago', 'mercadopago', 'mp']
        },
        {
            codePrefix: '11100508',
            nameKeyword: 'bancolombia',
            keywords: ['bancolombia', 'pago bancolombia', 'transferencia bancalombia']
        },
        {
            codePrefix: '11100501',
            nameKeyword: 'davivienda',
            keywords: ['davivienda', 'banco davivienda', 'transferencia davivienda', 'banco', 'bancos', 'transferencia', 'transferencia bancaria', 'cheque', 'cheques', 'consignacion', 'consignación']
        },
        {
            codePrefix: '233595',
            nameKeyword: 'otros',
            keywords: ['cuenta por pagar', 'por pagar', 'causar', 'causacion', 'causación', 'cxp', 'cuenta de cobro', 'cuentacobro']
        },
        {
            codePrefix: '513550',
            nameKeyword: 'transporte',
            keywords: ['flete', 'acarreo', 'transpor', 'carga', 'envio', 'envío', 'mensajer', 'domicili', 'trasteo', 'mudanza', 'despacho', 'enviar', 'mandar']
        },
        {
            codePrefix: '512010',
            nameKeyword: 'construcciones',
            keywords: ['arriendo', 'arriendos', 'alquiler', 'alquileres', 'arrendamiento', 'arrendamientos', 'canon', 'cánon', 'canon arrendamiento', 'renta local', 'renta oficina', 'arriendo oficina', 'arriendo local', 'arriendo bodega', 'alquiler oficina', 'alquiler local', 'alquiler bodega']
        },
        {
            codePrefix: '512510',
            nameKeyword: 'afiliaciones',
            keywords: ['afiliacion', 'afiliación', 'sostenimiento', 'membresia', 'membresía', 'camara de comercio', 'cámara de comercio', 'fenalco', 'cuota gremial', 'asociacion', 'asociación']
        },
        {
            codePrefix: '5130',
            nameKeyword: 'seguros',
            keywords: ['segur', 'poliz', 'póliz', 'sura', 'soat', 'allianz', 'mapfre']
        },
        {
            codePrefix: '519525',
            nameKeyword: 'cafeteria',
            keywords: ['tinto', 'cafe', 'café', 'azucar', 'azúcar', 'cafeteri', 'jabon', 'jabón', 'servillet', 'vaso', 'greca', 'te', 'té', 'aromatic', 'aromátic', 'galleta', 'pan', 'panes', 'detergente', 'lavaplatos', 'esponja', 'desinfectante', 'cloro', 'fabuloso', 'papel higienic', 'papel higiénico', 'aseo', 'limpiez']
        },
        {
            codePrefix: '519530',
            nameKeyword: 'papeleria',
            keywords: ['papel', 'util', 'útil', 'resma', 'lapicer', 'esfero', 'lapiz', 'lápiz', 'borrador', 'corrector', 'fotocop', 'impresi', 'carpet', 'cinta', 'toner', 'tóner', 'cartucho', 'tinta', 'marcador', 'cuadern', 'ganchos', 'cosedora', 'grapadora', 'perforadora', 'agenda']
        },
        {
            codePrefix: '519520',
            nameKeyword: 'representacion',
            keywords: ['almuerz', 'cena', 'comid', 'restauran', 'alimenta', 'desayun', 'invitaci', 'refrigeri', 'torta', 'ponque', 'ponqué', 'gaseosa', 'refresco', 'atencion cliente', 'atención cliente', 'relaciones publicas', 'relaciones públicas', 'representacion', 'representación']
        },
        {
            codePrefix: '519545',
            nameKeyword: 'taxis',
            keywords: ['taxi', 'colectiv', 'pasaje', 'bus', 'uber', 'didi', 'cabify', 'indriver', 'transporte publico', 'transporte público']
        },
        {
            codePrefix: '519535',
            nameKeyword: 'combustible',
            keywords: ['gasolin', 'acpm', 'lubrican', 'aditiv', 'combustib', 'tanqueo', 'tanquear']
        },
        {
            codePrefix: '519565',
            nameKeyword: 'parqueadero',
            keywords: ['parquead', 'estacionam', 'parqueo']
        },
        {
            codePrefix: '513505',
            nameKeyword: 'aseo',
            keywords: ['vigilanc', 'seguridad', 'celador', 'vigilante', 'guardia', 'portero', 'monitoreo alarma', 'alarma oficina']
        },
        {
            codePrefix: '513525',
            nameKeyword: 'acueducto',
            keywords: ['agua', 'acueduc', 'alcantar', 'factura agua', 'recibo agua']
        },
        {
            codePrefix: '513530',
            nameKeyword: 'energia',
            keywords: ['luz', 'energi', 'energí', 'electri', 'factura luz', 'recibo luz', 'enel', 'codensa']
        },
        {
            codePrefix: '51353503',
            nameKeyword: 'internet',
            keywords: ['wifi', 'internet', 'banda ancha', 'claro internet', 'movistar internet', 'tigo internet', 'etb internet', 'factura internet']
        },
        {
            codePrefix: '51353501',
            nameKeyword: 'telefono',
            keywords: ['telefono', 'teléfono', 'celular', 'minutos', 'recarga celular', 'recargas celular', 'factura celular', 'claro celular', 'movistar celular']
        },
        {
            codePrefix: '513555',
            nameKeyword: 'gas',
            keywords: ['gas natural', 'pipeta gas', 'vanti', 'factura gas', 'recibo gas']
        },
        {
            codePrefix: '514005',
            nameKeyword: 'notariales',
            keywords: ['notaria', 'notaría', 'autentic', 'escritur', 'firma notario']
        },
        {
            codePrefix: '514010',
            nameKeyword: 'registro',
            keywords: ['registro mercantil', 'renovacion camara', 'renovación cámara', 'renovacion matricula', 'renovación matrícula', 'camara comercio', 'cámara de comercio']
        },
        {
            codePrefix: '514510',
            nameKeyword: 'construcciones',
            keywords: ['mantenimiento oficina', 'reparaciones locativas', 'pintura oficina', 'pintar oficina', 'resane', 'arreglo oficina', 'gotera', 'plomero', 'plomer', 'cerrajero', 'cerrajer']
        },
        {
            codePrefix: '514525',
            nameKeyword: 'computacion',
            keywords: ['mantenimiento pc', 'mantenimiento computador', 'reparacion pc', 'reparación pc', 'reparar portatil', 'reparar portátil', 'formateo', 'formatear', 'antivirus', 'cambio disco duro', 'soporte tecnico', 'soporte técnico']
        },
        {
            codePrefix: '514540',
            nameKeyword: 'transporte',
            keywords: ['mecanico', 'mecánico', 'taller carro', 'taller moto', 'repuestos carro', 'repuestos moto', 'repuesto', 'cambio de aceite', 'sincronizacion', 'sincronización', 'llanta', 'pinchada', 'pinchazo', 'alineacion', 'alineación', 'balanceo']
        },
        {
            codePrefix: '515505',
            nameKeyword: 'alojamiento',
            keywords: ['alojamien', 'manutencion', 'manutención', 'hotel', 'hospedaje', 'estadía', 'estadia', 'viaticos viaje', 'viáticos viaje']
        },
        {
            codePrefix: '515515',
            nameKeyword: 'pasajes',
            keywords: ['pasajes aereos', 'pasajes aéreos', 'tiquete aereo', 'tiquete aéreo', 'tiquetes aereos', 'tiquetes aéreos', 'vuelo', 'tiquete avianca', 'tiquete latam']
        },
        {
            codePrefix: '515520',
            nameKeyword: 'pasajes',
            keywords: ['pasajes terrestres', 'tiquete bus', 'pasaje bus']
        },
        {
            codePrefix: '519505',
            nameKeyword: 'comisiones',
            keywords: ['comision', 'comisión', 'comisiones', 'comision bancaria', 'comisión bancaria', 'comision pasarela', 'comision mercado libre', 'comision mercadolibre', 'comision tarjeta', 'comision datafono']
        },
        {
            codePrefix: '510506',
            nameKeyword: 'sueldos',
            keywords: ['sueldo', 'salario', 'nómina', 'nomina', 'jornal', 'quincena', 'mensualidad empleado', 'pago empleado', 'pago de nomina', 'pago de quincena', 'remunerac']
        },
        {
            codePrefix: '510527',
            nameKeyword: 'transporte',
            keywords: ['auxilio transporte', 'auxilio de transporte', 'subsidio transporte', 'subsidio de transporte']
        },
        {
            codePrefix: '510528',
            nameKeyword: 'conectividad',
            keywords: ['auxilio conectividad', 'auxilio de conectividad', 'subsidio conectividad', 'subsidio de conectividad', 'auxilio internet']
        },
        {
            codePrefix: '510530',
            nameKeyword: 'cesantias',
            keywords: ['cesantias', 'cesantías', 'intereses cesantias', 'intereses de cesantias', 'prima de servicios', 'prima legal', 'vacaciones', 'liquidacion laboral', 'liquidación laboral', 'liquidación empleado']
        },
        {
            codePrefix: '510563',
            nameKeyword: 'capacitacion',
            keywords: ['capacitacion', 'capacitación', 'curso', 'entrenamiento', 'seminario', 'taller personal', 'formacion personal']
        },
        {
            codePrefix: '510569',
            nameKeyword: 'salud',
            keywords: ['aportes eps', 'pago eps', 'salud empleado', 'seguridad social eps', 'sanitas', 'sura eps', 'compensar eps', 'salud total', 'nueva eps']
        },
        {
            codePrefix: '510570',
            nameKeyword: 'pensiones',
            keywords: ['aportes pension', 'aportes pensión', 'pago pension', 'pago pensión', 'porvenir', 'proteccion', 'colpensiones', 'skandia']
        },
        {
            codePrefix: '510572',
            nameKeyword: 'cajas',
            keywords: ['caja compensacion', 'caja de compensacion', 'cafam', 'colsubsidio', 'compensar caja', 'comfandi', 'comfenalco']
        },
        {
            codePrefix: '511025',
            nameKeyword: 'juridica',
            keywords: ['abogado', 'pleito', 'demanda', 'asesoria juridica', 'asesoría jurídica', 'asesoria legal', 'asesoría legal', 'defensa legal', 'honorarios abogado', 'notificacion judicial']
        },
        {
            codePrefix: '511010',
            nameKeyword: 'revisoria',
            keywords: ['revisor fiscal', 'revisoria fiscal', 'revisoría fiscal', 'auditor', 'auditoria', 'auditoría', 'auditor externo', 'asesoria financiera', 'asesoría financiera', 'asesoria tributaria', 'asesoría tributaria', 'declaracion de renta', 'declaración de renta', 'impuestos honorarios']
        },
        {
            codePrefix: '511505',
            nameKeyword: 'industria',
            keywords: ['reteica', 'ica', 'industria y comercio', 'impuesto industria y comercio', 'pago ica', 'pago reteica']
        },
        {
            codePrefix: '513040',
            nameKeyword: 'transporte',
            keywords: ['soat', 'seguro carro', 'seguro auto', 'seguro camion', 'seguro moto', 'seguro vehiculo', 'seguro vehículo', 'poliza carro', 'póliza vehículo', 'seguro de automovil']
        },
        {
            codePrefix: '519595',
            nameKeyword: 'otros',
            keywords: ['otros diversos', 'gastos diversos', 'reembolso caja menor', 'caja menor', 'gastos varios']
        }
    ];

    // Función auxiliar para buscar coincidencia de palabra completa para palabras clave cortas (<= 3 letras)
    const hasKeyword = (keyword) => {
        if (keyword.length <= 3) {
            const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp('\\b' + escaped + '\\b', 'i');
            return regex.test(text);
        }
        return text.includes(keyword);
    };

    for (const rule of rules) {
        for (const keyword of rule.keywords) {
            if (hasKeyword(keyword)) {
                return { codePrefix: rule.codePrefix, nameKeyword: rule.nameKeyword };
            }
        }
    }
    
    return null;
}

function findPucAccountForConcept(conceptText) {
    const mapping = mapConceptToExpenseAccount(conceptText);
    if (!mapping) return null;
    
    let code = mapping.codePrefix;
    let matches = [];
    
    // Buscar la cuenta con el código, recortando un dígito de la derecha si no se encuentra activa en el PUC
    while (code.length >= 2) {
        matches = cachePuc.filter(p => p.codigo.startsWith(code) && p.activo === 1);
        if (matches.length > 0) {
            break;
        }
        code = code.slice(0, -1);
    }
    
    if (matches.length === 0) return null;
    
    // Ordenar de mayor longitud a menor longitud para preferir subcuentas específicas
    matches.sort((a, b) => b.codigo.length - a.codigo.length);
    
    // Intentar buscar una que contenga la palabra clave del nombre
    const nameMatch = matches.find(p => p.nombre.toLowerCase().includes(mapping.nameKeyword));
    if (nameMatch) return nameMatch;
    
    // Retornar la primera coincidencia (la más específica)
    return matches[0];
}

function prepareNcDocView() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('nc-doc-fecha').value = today;
    document.getElementById('nc-doc-concepto').value = '';
    
    const menu = document.getElementById('nc-payment-dropdown-menu');
    if (menu) menu.style.display = 'none';
    
    // Vaciar tabla HTML anterior
    const tbody = document.querySelector('#nc-ledger-table tbody');
    tbody.innerHTML = '';
    
    ncRows = [];
    
    // Crear 2 filas en blanco de inicio para facilitar el cuadre
    addNcGridRow();
    addNcGridRow();
    updateNcTotals();
}

function addNcGridRow() {
    const index = ncRows.length;
    ncRows.push({
        cuenta_codigo: '',
        tercero_id: '',
        concepto_linea: '',
        debito: 0,
        credito: 0
    });
    
    const tbody = document.querySelector('#nc-ledger-table tbody');
    const tr = document.createElement('tr');
    tr.id = `nc-row-${index}`;
    tr.innerHTML = `
        <td>
            <div class="search-container">
                <input type="text" id="nc-puc-search-${index}" placeholder="Buscar cuenta PUC..." autocomplete="off" required>
                <input type="hidden" id="nc-puc-${index}">
                <div id="nc-puc-results-${index}" class="search-results-dropdown" style="display:none;"></div>
            </div>
        </td>
        <td>
            <div class="search-container">
                <input type="text" id="nc-tercero-search-${index}" placeholder="Tercero (opcional)..." autocomplete="off">
                <input type="hidden" id="nc-tercero-${index}">
                <div id="nc-tercero-results-${index}" class="search-results-dropdown" style="display:none;"></div>
            </div>
        </td>
        <td>
            <input type="text" id="nc-desc-${index}" placeholder="Concepto de línea..." required>
        </td>
        <td>
            <input type="number" class="col-amount-input" id="nc-deb-${index}" placeholder="0" min="0" step="1">
        </td>
        <td>
            <input type="number" class="col-amount-input" id="nc-cre-${index}" placeholder="0" min="0" step="1">
        </td>
        <td>
            <button type="button" class="delete-row-btn" onclick="removeNcGridRow(${index})">
                <i class="fa-solid fa-trash"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    
    // Inicializar autocompletados
    setupAutocomplete(`nc-puc-search-${index}`, `nc-puc-${index}`, `nc-puc-results-${index}`, 'puc', (item) => {
        if (item) {
            ncRows[index].cuenta_codigo = item.codigo;
            
            // Auto-llenar crédito si es cuenta contrapartida (Clase 11 o 23) y montos en cero
            const isContrapartida = item.codigo.startsWith('11') || item.codigo.startsWith('23');
            const currentDeb = parseFloat(debInput.value) || 0;
            const currentCre = parseFloat(creInput.value) || 0;
            
            if (isContrapartida && currentDeb === 0 && currentCre === 0) {
                let totalDeb = 0;
                let totalCre = 0;
                ncRows.forEach((r, idx) => {
                    if (idx !== index) {
                        totalDeb += r.debito;
                        totalCre += r.credito;
                    }
                });
                const diff = totalDeb - totalCre;
                if (diff > 0) {
                    creInput.value = Math.round(diff);
                    ncRows[index].credito = Math.round(diff);
                    ncRows[index].debito = 0;
                }
            }
        } else {
            ncRows[index].cuenta_codigo = '';
        }
        updateNcTotals();
    });
    
    setupAutocomplete(`nc-tercero-search-${index}`, `nc-tercero-${index}`, `nc-tercero-results-${index}`, 'terceros', (item) => {
        if (item) {
            ncRows[index].tercero_id = item.id;
        } else {
            ncRows[index].tercero_id = '';
        }
        updateNcTotals();
    });
    
    // Capturar inputs
    const descInput = document.getElementById(`nc-desc-${index}`);
    const debInput = document.getElementById(`nc-deb-${index}`);
    const creInput = document.getElementById(`nc-cre-${index}`);
    
    descInput.addEventListener('input', () => {
        ncRows[index].concepto_linea = descInput.value.trim();
    });
    
    descInput.addEventListener('blur', () => {
        const searchInput = document.getElementById(`nc-puc-search-${index}`);
        // Solo auto-clasificar si la cuenta no ha sido seleccionada o está vacía
        if (searchInput && !searchInput.value.trim()) {
            const val = descInput.value.trim();
            if (val) {
                const matchedAccount = findPucAccountForConcept(val);
                if (matchedAccount) {
                    const hiddenInput = document.getElementById(`nc-puc-${index}`);
                    
                    searchInput.value = `${matchedAccount.codigo} - ${matchedAccount.nombre}`;
                    hiddenInput.value = matchedAccount.codigo;
                    ncRows[index].cuenta_codigo = matchedAccount.codigo;
                    
                    // Auto-llenar crédito si es cuenta contrapartida (Clase 11 o 23) y montos en cero
                    const isContrapartida = matchedAccount.codigo.startsWith('11') || matchedAccount.codigo.startsWith('23');
                    const currentDeb = parseFloat(debInput.value) || 0;
                    const currentCre = parseFloat(creInput.value) || 0;
                    
                    if (isContrapartida && currentDeb === 0 && currentCre === 0) {
                        let totalDeb = 0;
                        let totalCre = 0;
                        ncRows.forEach((r, idx) => {
                            if (idx !== index) {
                                totalDeb += r.debito;
                                totalCre += r.credito;
                            }
                        });
                        const diff = totalDeb - totalCre;
                        if (diff > 0) {
                            creInput.value = Math.round(diff);
                            ncRows[index].credito = Math.round(diff);
                            ncRows[index].debito = 0;
                        }
                    }
                    
                    updateNcTotals();
                    
                    // Efecto visual: Destellar en verde
                    searchInput.style.transition = 'border-color 0.3s, box-shadow 0.3s';
                    searchInput.style.borderColor = '#10b981';
                    searchInput.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.2)';
                    setTimeout(() => {
                        searchInput.style.borderColor = '';
                        searchInput.style.boxShadow = '';
                    }, 1500);
                }
            }
        }
    });
    
    debInput.addEventListener('input', () => {
        if (parseFloat(debInput.value) > 0) {
            creInput.value = '';
            ncRows[index].credito = 0;
        }
        ncRows[index].debito = parseFloat(debInput.value) || 0;
        updateNcTotals();
    });
    
    creInput.addEventListener('input', () => {
        if (parseFloat(creInput.value) > 0) {
            debInput.value = '';
            ncRows[index].debito = 0;
        }
        ncRows[index].credito = parseFloat(creInput.value) || 0;
        updateNcTotals();
    });
}

function toggleNcPaymentDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('nc-payment-dropdown-menu');
    if (menu) {
        const isVisible = menu.style.display === 'block';
        menu.style.display = isVisible ? 'none' : 'block';
    }
}

function selectNcPaymentMethod(event, type) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const menu = document.getElementById('nc-payment-dropdown-menu');
    if (menu) {
        menu.style.display = 'none';
    }
    addNcQuickContrapartida(type);
}

function addNcQuickContrapartida(type) {
    // 1. Calcular la diferencia (totalDeb - totalCre)
    let totalDeb = 0;
    let totalCre = 0;
    ncRows.forEach(r => {
        totalDeb += r.debito;
        totalCre += r.credito;
    });
    const diff = totalDeb - totalCre;
    if (diff <= 0) {
        alert('No hay una diferencia (débito) por cuadrar.');
        return;
    }
    
    // 2. Definir los datos de la contrapartida
    let codePrefix = '';
    let nameKeyword = '';
    let conceptLabel = '';
    
    switch(type) {
        case 'caja':
            codePrefix = '11050501';
            nameKeyword = 'caja';
            conceptLabel = 'Pago en efectivo';
            break;
        case 'nequi':
            codePrefix = '11100510';
            nameKeyword = 'nequi';
            conceptLabel = 'Pago Nequi';
            break;
        case 'bancolombia':
            codePrefix = '11100508';
            nameKeyword = 'bancolombia';
            conceptLabel = 'Pago Bancolombia';
            break;
        case 'davivienda':
            codePrefix = '11100501';
            nameKeyword = 'davivienda';
            conceptLabel = 'Pago Davivienda';
            break;
        case 'cxp':
            // Causación de cuenta por pagar. Intentar ser inteligente según los débitos ingresados.
            codePrefix = '233595';
            nameKeyword = 'otros';
            conceptLabel = 'Causación de gasto';
            
            // Buscar si hay alguna cuenta de gasto (Clase 5) registrada en las filas
            const firstExpenseRow = ncRows.find(r => r.cuenta_codigo && r.cuenta_codigo.startsWith('51') && r.debito > 0);
            if (firstExpenseRow) {
                const expCode = firstExpenseRow.cuenta_codigo;
                if (expCode.startsWith('5120')) { // Arrendamientos
                    codePrefix = '233540';
                    nameKeyword = 'arrendamiento';
                } else if (expCode.startsWith('513550') || expCode.startsWith('519545') || expCode.startsWith('515520')) { // Transportes, fletes, acarreos
                    codePrefix = '233545';
                    nameKeyword = 'transporte';
                } else if (expCode.startsWith('5130')) { // Seguros
                    codePrefix = '233555';
                    nameKeyword = 'seguro';
                } else if (expCode.startsWith('5110')) { // Honorarios
                    codePrefix = '233525';
                    nameKeyword = 'honorario';
                } else if (expCode.startsWith('513525') || expCode.startsWith('513530') || expCode.startsWith('513535') || expCode.startsWith('513555')) { // Servicios públicos
                    codePrefix = '233550';
                    nameKeyword = 'publico';
                } else if (expCode.startsWith('5145')) { // Mantenimiento
                    codePrefix = '233535';
                    nameKeyword = 'mantenimiento';
                } else if (expCode.startsWith('5140')) { // Gastos legales / notariales
                    codePrefix = '233510';
                    nameKeyword = 'legal';
                }
            }
            break;
    }
    
    // 3. Buscar la cuenta PUC en cachePuc
    let matches = cachePuc.filter(p => p.codigo.startsWith(codePrefix) && p.activo === 1);
    // Ordenar de mayor longitud a menor para preferir subcuentas específicas
    matches.sort((a, b) => b.codigo.length - a.codigo.length);
    let matchedAccount = matches.find(p => p.nombre.toLowerCase().includes(nameKeyword));
    if (!matchedAccount && matches.length > 0) {
        matchedAccount = matches[0];
    }
    
    if (!matchedAccount) {
        alert('No se encontró una cuenta contable activa para la contrapartida.');
        return;
    }
    
    // 4. Buscar la primera fila vacía para rellenar, o si no hay crear una nueva
    let targetIdx = -1;
    for (let i = 0; i < ncRows.length; i++) {
        const searchInput = document.getElementById(`nc-puc-search-${i}`);
        const descInput = document.getElementById(`nc-desc-${i}`);
        if (searchInput && !searchInput.value.trim() && descInput && !descInput.value.trim()) {
            targetIdx = i;
            break;
        }
    }
    if (targetIdx === -1) {
        for (let i = 0; i < ncRows.length; i++) {
            const searchInput = document.getElementById(`nc-puc-search-${i}`);
            if (searchInput && !searchInput.value.trim()) {
                targetIdx = i;
                break;
            }
        }
    }
    if (targetIdx === -1) {
        addNcGridRow();
        targetIdx = ncRows.length - 1;
    }
    
    // 5. Rellenar los valores en la fila
    const searchInput = document.getElementById(`nc-puc-search-${targetIdx}`);
    const hiddenInput = document.getElementById(`nc-puc-${targetIdx}`);
    const descInput = document.getElementById(`nc-desc-${targetIdx}`);
    const debInput = document.getElementById(`nc-deb-${targetIdx}`);
    const creInput = document.getElementById(`nc-cre-${targetIdx}`);
    
    if (searchInput && hiddenInput && descInput && debInput && creInput) {
        searchInput.value = `${matchedAccount.codigo} - ${matchedAccount.nombre}`;
        hiddenInput.value = matchedAccount.codigo;
        ncRows[targetIdx].cuenta_codigo = matchedAccount.codigo;
        
        descInput.value = conceptLabel;
        ncRows[targetIdx].concepto_linea = conceptLabel;
        
        debInput.value = '';
        ncRows[targetIdx].debito = 0;
        
        const roundedDiff = Math.round(diff);
        creInput.value = roundedDiff;
        ncRows[targetIdx].credito = roundedDiff;
        
        updateNcTotals();
        
        // Destellar en verde la fila completada
        searchInput.style.transition = 'border-color 0.3s, box-shadow 0.3s';
        searchInput.style.borderColor = '#10b981';
        searchInput.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.2)';
        
        descInput.style.transition = 'border-color 0.3s, box-shadow 0.3s';
        descInput.style.borderColor = '#10b981';
        descInput.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.2)';
        
        creInput.style.transition = 'border-color 0.3s, box-shadow 0.3s';
        creInput.style.borderColor = '#10b981';
        creInput.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.2)';
        
        setTimeout(() => {
            searchInput.style.borderColor = '';
            searchInput.style.boxShadow = '';
            descInput.style.borderColor = '';
            descInput.style.boxShadow = '';
            creInput.style.borderColor = '';
            creInput.style.boxShadow = '';
        }, 1500);
    }
}

function removeNcGridRow(index) {
    ncRows.splice(index, 1);
    
    // Re-dibujar completo para evitar desfase de índices en listeners
    const tbody = document.querySelector('#nc-ledger-table tbody');
    tbody.innerHTML = '';
    
    const backupRows = [...ncRows];
    ncRows = [];
    
    backupRows.forEach((r, idx) => {
        addNcGridRow();
        const row = ncRows[idx];
        row.cuenta_codigo = r.cuenta_codigo;
        row.tercero_id = r.tercero_id;
        row.concepto_linea = r.concepto_linea;
        row.debito = r.debito;
        row.credito = r.credito;
        
        if (r.cuenta_codigo) {
            const acc = cachePuc.find(p => p.codigo === r.cuenta_codigo);
            document.getElementById(`nc-puc-${idx}`).value = r.cuenta_codigo;
            document.getElementById(`nc-puc-search-${idx}`).value = acc ? `${acc.codigo} - ${acc.nombre}` : r.cuenta_codigo;
        }
        if (r.tercero_id) {
            const t = cacheTerceros.find(tc => tc.id === r.tercero_id);
            const fullname = t ? t.nombre + (t.apellidos ? ' ' + t.apellidos : '') : '';
            document.getElementById(`nc-tercero-${idx}`).value = r.tercero_id;
            document.getElementById(`nc-tercero-search-${idx}`).value = t ? `${t.identificacion} - ${fullname}` : '';
        }
        document.getElementById(`nc-desc-${idx}`).value = r.concepto_linea;
        document.getElementById(`nc-deb-${idx}`).value = r.debito > 0 ? r.debito : '';
        document.getElementById(`nc-cre-${idx}`).value = r.credito > 0 ? r.credito : '';
    });
    
    updateNcTotals();
}

function updateNcTotals() {
    let totalDeb = 0;
    let totalCre = 0;
    
    ncRows.forEach(r => {
        totalDeb += r.debito;
        totalCre += r.credito;
    });
    
    const diff = totalDeb - totalCre;
    
    document.getElementById('nc-stat-debits').innerText = formatMoney(totalDeb);
    document.getElementById('nc-stat-credits').innerText = formatMoney(totalCre);
    
    const diffEl = document.getElementById('nc-stat-diff');
    diffEl.innerText = formatMoney(diff);
    
    const submitBtn = document.getElementById('nc-submit-btn');
    if (Math.abs(diff) <= 0.02 && totalDeb > 0 && ncRows.every(r => r.cuenta_codigo && r.concepto_linea)) {
        diffEl.style.color = 'green';
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
    } else {
        diffEl.style.color = 'red';
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
    }
}

async function submitNcDoc(e) {
    e.preventDefault();
    
    let totalDeb = 0;
    let totalCre = 0;
    ncRows.forEach(r => {
        totalDeb += r.debito;
        totalCre += r.credito;
    });
    
    if (Math.abs(totalDeb - totalCre) > 0.02) {
        alert('Descuadre contable: El total de Débitos debe ser igual al de Créditos.');
        return;
    }
    
    let concept = document.getElementById('nc-doc-concepto').value.trim();
    if (!concept) {
        // Concatenar los conceptos de los renglones para la glosa general
        concept = ncRows.map(r => r.concepto_linea).filter(c => c).join(', ') || 'Gastos Varios';
    }
    const fecha = document.getElementById('nc-doc-fecha').value;
    
    const body = {
        fecha,
        concepto: `NC: ${concept}`,
        lineas: ncRows.filter(r => r.debito > 0 || r.credito > 0).map(r => ({
            cuenta_codigo: r.cuenta_codigo,
            tercero_id: r.tercero_id ? parseInt(r.tercero_id) : null,
            concepto_linea: r.concepto_linea,
            debito: r.debito,
            credito: r.credito
        })),
        usuario: currentUserId
    };
    
    if (body.lineas.length === 0) {
        alert('Debe ingresar movimientos válidos antes de registrar.');
        return;
    }
    
    try {
        const result = await fetchApi(`/${activeTenant}/nota-contabilidad`, { method: 'POST', body });
        alert(`Nota de Contabilidad NC-${result.numero} guardada y causada con éxito.`);
        prepareNcDocView();
        loadNextDocumentNumbers();
        changeView('documentos-hub');
    } catch(err) {
        alert('Error al registrar nota contable: ' + err.message);
    }
}

// ==========================================================================
// SECCIÓN: CONSULTA Y BÚSQUEDA DE DOCUMENTOS
// ==========================================================================
let cacheConsultedDocs = [];

async function prepareConsultaDocsView() {
    const today = new Date().toISOString().split('T')[0];
    const pastMonthDate = new Date();
    pastMonthDate.setDate(pastMonthDate.getDate() - 30);
    const pastMonth = pastMonthDate.toISOString().split('T')[0];
    
    document.getElementById('fil-desde').value = pastMonth;
    document.getElementById('fil-hasta').value = today;
    document.getElementById('fil-search').value = '';
    document.getElementById('fil-tipo').value = 'ALL';
    document.getElementById('fil-producto').value = '';
    document.getElementById('fil-producto-search').value = '';
    
    await loadConsultaDocs();
}

async function loadConsultaDocs() {
    try {
        const data = await fetchApi(`/${activeTenant}/asientos`);
        cacheConsultedDocs = data;
        filterDocuments();
    } catch(err) {
        console.error('Error loading documents:', err);
    }
}

function filterDocuments() {
    const searchVal = document.getElementById('fil-search').value.toLowerCase().trim();
    const typeVal = document.getElementById('fil-tipo').value;
    const desdeVal = document.getElementById('fil-desde').value;
    const hastaVal = document.getElementById('fil-hasta').value;
    const productVal = document.getElementById('fil-producto').value;
    
    let filtered = cacheConsultedDocs;
    
    // 1. Filtrar por tipo
    if (typeVal !== 'ALL') {
        filtered = filtered.filter(doc => doc.tipo_documento === typeVal);
    }
    
    // 2. Filtrar por rango de fechas
    if (desdeVal) {
        filtered = filtered.filter(doc => doc.fecha >= desdeVal);
    }
    if (hastaVal) {
        filtered = filtered.filter(doc => doc.fecha <= hastaVal);
    }
    
    // 3. Filtrar por texto libre (Nit, Nombre, Número o Concepto)
    if (searchVal) {
        filtered = filtered.filter(doc => {
            const docNum = `${doc.tipo_documento}-${doc.numero}`.toLowerCase();
            const concept = (doc.concepto || '').toLowerCase();
            return docNum.includes(searchVal) || concept.includes(searchVal);
        });
    }
    
    // 4. Filtrar por Producto (buscando el SKU indexado en el concepto)
    if (productVal) {
        const prod = findProductById(productVal);
        if (prod) {
            const sku = prod.codigo.toLowerCase();
            filtered = filtered.filter(doc => (doc.concepto || '').toLowerCase().includes(sku));
        }
    }
    
    renderConsultedDocsList(filtered);
}

function renderConsultedDocsList(list) {
    const tbody = document.getElementById('consulta-docs-table-body');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No se encontraron documentos contables con los filtros seleccionados</td></tr>';
        return;
    }
    
    list.forEach(doc => {
        const tr = document.createElement('tr');
        if (doc.anulado === 1) {
            tr.style.backgroundColor = 'rgba(239, 68, 68, 0.04)';
        }
        
        const stateBadges = {
            'NO_APLICA': '<span class="badge">N/A</span>',
            'PENDIENTE': '<span class="badge badge-pending">Pendiente DIAN</span>',
            'ENVIADO': '<span class="badge badge-success">Aprobado DIAN</span>',
            'CONTINGENCIA': '<span class="badge badge-alert">Contingencia</span>'
        };
        
        const docState = doc.anulado === 1 ? '<span class="badge badge-alert">ANULADO</span>' : '<span class="badge badge-success">Vigente</span>';
        
        // Formatear Tercero desde el Concepto o general
        let displayTercero = 'Ajuste Contable';
        if (doc.concepto && doc.concepto.includes('Tercero:')) {
            displayTercero = doc.concepto.split('Tercero:')[1].trim();
        } else if (doc.concepto && doc.concepto.includes('Empleado:')) {
            displayTercero = doc.concepto.split('Empleado:')[1].trim();
        } else if (doc.concepto) {
            displayTercero = doc.concepto.length > 40 ? doc.concepto.substring(0, 40) + '...' : doc.concepto;
        }
        
        tr.innerHTML = `
            <td><strong>${doc.tipo_documento}-${doc.numero}</strong></td>
            <td>${doc.fecha}</td>
            <td>${displayTercero}</td>
            <td>${doc.concepto || 'Asiento de contabilidad'}</td>
            <td style="text-align:right; font-weight:700;">${formatMoney(doc.total_documento)}</td>
            <td>${stateBadges[doc.dian_estado] || doc.dian_estado}</td>
            <td>${docState}</td>
            <td>
                <button class="btn btn-secondary" onclick="viewAsientoDetails(${doc.id})" style="padding:4px 10px; font-size:11px;">
                    <i class="fa-solid fa-eye"></i> Ver
                </button>
                ${doc.anulado === 0 ? `
                    <button class="btn btn-secondary" onclick="voidConsultedDocument(${doc.id})" style="padding:4px 10px; font-size:11px; color:#ef4444; border-color:rgba(239, 68, 68, 0.15);">
                        <i class="fa-solid fa-ban"></i> Anular
                    </button>
                ` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function voidConsultedDocument(id) {
    if (!confirm('¿Está seguro de que desea anular este documento? Esto creará un contraasiento revertiendo los saldos a cero.')) {
        return;
    }
    try {
        await fetchApi(`/${activeTenant}/anular/${id}`, { method: 'POST', body: { usuario: currentUserId } });
        alert('Documento anulado con éxito y saldos revertidos.');
        await loadConsultaDocs();
    } catch(err) {
        alert('Error al anular: ' + err.message);
    }
}

function clearFilters() {
    document.getElementById('fil-search').value = '';
    document.getElementById('fil-tipo').value = 'ALL';
    document.getElementById('fil-producto').value = '';
    document.getElementById('fil-producto-search').value = '';
    
    const today = new Date().toISOString().split('T')[0];
    const pastMonthDate = new Date();
    pastMonthDate.setDate(pastMonthDate.getDate() - 30);
    const pastMonth = pastMonthDate.toISOString().split('T')[0];
    
    document.getElementById('fil-desde').value = pastMonth;
    document.getElementById('fil-hasta').value = today;
    
    filterDocuments();
}

// TOGGLE AND RESET FORM UTILITIES
function toggleAccounting(docType) {
    const box = document.getElementById(`${docType}-accounting-box`);
    if (!box) return;
    if (box.classList.contains('collapsed')) {
        box.classList.remove('collapsed');
        box.classList.add('expanded');
    } else {
        box.classList.remove('expanded');
        box.classList.add('collapsed');
    }
}

function resetForm(docType) {
    if (docType === 'fv') {
        const form = document.getElementById('factura-form');
        if (form) form.reset();
        invoiceItems = [];
        renderInvoiceItems();
        updateInvoiceTotals();
        const today = new Date().toISOString().split('T')[0];
        if (document.getElementById('fac-fecha')) document.getElementById('fac-fecha').value = today;
        if (document.getElementById('fac-prefijo')) document.getElementById('fac-prefijo').value = 'SET';
        
        const verBtn = document.getElementById('fac-btn-ver-factura');
        if (verBtn) verBtn.style.display = 'none';
    } else if (docType === 'ds') {
        const form = document.getElementById('compra-form');
        if (form) form.reset();
        purchaseItems = [];
        renderPurchaseItems();
        updatePurchaseTotals();
        const today = new Date().toISOString().split('T')[0];
        if (document.getElementById('com-fecha')) document.getElementById('com-fecha').value = today;
    } else if (docType === 'ce') {
        const form = document.getElementById('ce-doc-form');
        if (form) form.reset();
        const today = new Date().toISOString().split('T')[0];
        if (document.getElementById('ce-doc-fecha')) document.getElementById('ce-doc-fecha').value = today;
        if (document.getElementById('ce-doc-cuenta-gasto')) document.getElementById('ce-doc-cuenta-gasto').value = '2205';
        if (document.getElementById('ce-doc-cuenta-gasto-search')) document.getElementById('ce-doc-cuenta-gasto-search').value = '2205 - PROVEEDORES NACIONALES';
        updateCeDocContabilizacion();
    } else if (docType === 'rc') {
        const form = document.getElementById('rc-doc-form');
        if (form) form.reset();
        const today = new Date().toISOString().split('T')[0];
        if (document.getElementById('rc-doc-fecha')) document.getElementById('rc-doc-fecha').value = today;
        if (document.getElementById('rc-doc-cuenta-ingreso')) document.getElementById('rc-doc-cuenta-ingreso').value = '130505';
        if (document.getElementById('rc-doc-cuenta-ingreso-search')) document.getElementById('rc-doc-cuenta-ingreso-search').value = '130505 - CLIENTES NACIONALES';
        updateRcDocContabilizacion();
    } else if (docType === 'nm') {
        const form = document.getElementById('nm-doc-form');
        if (form) form.reset();
        const today = new Date().toISOString().split('T')[0];
        if (document.getElementById('nm-doc-fecha')) document.getElementById('nm-doc-fecha').value = today;
        updateNmDocContabilizacion();
    } else if (docType === 'nc') {
        const form = document.getElementById('nc-doc-form');
        if (form) form.reset();
        const today = new Date().toISOString().split('T')[0];
        if (document.getElementById('nc-doc-fecha')) document.getElementById('nc-doc-fecha').value = today;
        prepareNcDocView();
    }
    clearAutocompleteFields();
}

// ==========================================================================
// DOCUMENT PRINTING SYSTEM (window.print() with OS connection)
// ==========================================================================
function sendToPrinter(htmlContent) {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
        alert('Por favor habilite las ventanas emergentes (popups) para poder imprimir los documentos.');
        return;
    }
    printWindow.document.open();
    printWindow.document.write(`
        <html>
        <head>
            <title>Impresión de Documento - SIMPLIX ERP</title>
            <style>
                body {
                    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                    color: #333;
                    padding: 20px;
                    line-height: 1.5;
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                    border-bottom: 2px solid #eaeaea;
                    padding-bottom: 20px;
                }
                .header h1 {
                    margin: 0;
                    font-size: 24px;
                    color: #1e40af;
                }
                .header p {
                    margin: 5px 0 0 0;
                    color: #666;
                    font-size: 14px;
                }
                .meta-table {
                    width: 100%;
                    margin-bottom: 25px;
                    border-collapse: collapse;
                }
                .meta-table td {
                    padding: 6px;
                    vertical-align: top;
                    font-size: 13px;
                }
                .meta-table td.label {
                    font-weight: bold;
                    color: #555;
                    width: 150px;
                }
                .items-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 30px;
                }
                .items-table th {
                    background-color: #f3f4f6;
                    border: 1px solid #e5e7eb;
                    padding: 10px;
                    font-size: 12px;
                    text-align: left;
                    font-weight: 700;
                }
                .items-table td {
                    border: 1px solid #e5e7eb;
                    padding: 10px;
                    font-size: 12px;
                }
                .text-right {
                    text-align: right;
                }
                .totals-box {
                    float: right;
                    width: 300px;
                    margin-bottom: 30px;
                }
                .totals-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 6px 0;
                    font-size: 13px;
                    border-bottom: 1px solid #f3f4f6;
                }
                .totals-row.grand-total {
                    font-weight: bold;
                    font-size: 16px;
                    border-top: 2px solid #333;
                    border-bottom: none;
                    color: #000;
                }
                .accounting-section {
                    clear: both;
                    margin-top: 40px;
                    border-top: 1px dashed #ccc;
                    padding-top: 20px;
                }
                .accounting-section h3 {
                    font-size: 14px;
                    text-transform: uppercase;
                    margin-bottom: 15px;
                    color: #555;
                }
            </style>
        </head>
        <body onload="window.print(); setTimeout(function(){ window.close(); }, 500);">
            ${htmlContent}
        </body>
        </html>
    `);
    printWindow.document.close();
}

function printCurrentDocument(docType) {
    const tenantName = activeTenant === 'importadora' ? 'IMPORTADORA KYH SAS' : 'CLUB SOL DEL VALLE';
    const tenantNit = activeTenant === 'importadora' ? '901785745-5' : '800.987.654-3';
    
    let html = '';
    
    if (docType === 'fv') {
        const clientSearch = document.getElementById('fac-cliente-search').value;
        const fecha = document.getElementById('fac-fecha').value;
        const pago = document.getElementById('fac-pago').value;
        const prefijo = document.getElementById('fac-prefijo').value;
        
        const subtotal = document.getElementById('tot-subtotal').innerText;
        const iva = document.getElementById('tot-iva').innerText;
        const retefte = document.getElementById('tot-retefte').innerText;
        const reteica = document.getElementById('tot-reteica').innerText;
        const total = document.getElementById('tot-neto').innerText;
        
        const hasDiscount = document.getElementById('fac-has-discount') ? document.getElementById('fac-has-discount').checked : false;
        const discountValPrint = hasDiscount ? document.getElementById('tot-discount').innerText : '$0.00';
        
        const clienteId = parseInt(document.getElementById('fac-cliente').value);
        const client = cacheTerceros.find(t => t.id === clienteId) || {};
        const customerName = client.nombre ? (client.nombre + (client.apellidos ? ' ' + client.apellidos : '')) : (clientSearch || 'Cliente General');
        const customerNit = client.identificacion || 'S/D';
        const customerAddress = client.direccion || 'No Registrada';
        const customerCity = client.ciudad || 'Cajicá';
        const customerPhone = client.telefono || 'S/D';
        const customerEmail = client.email || 'S/D';

        const isImportadora = activeTenant === 'importadora';
        const companyName = isImportadora ? 'IMPORTADORA KYH SAS' : 'CLUB SOL DEL VALLE';
        const companyNit = isImportadora ? '901785745-5' : '800.987.654-3';
        const companyAddress = isImportadora ? 'Carrera 6 # 0 - 56 Cajica' : 'Kilómetro 4 Vía al Mar, Cali';
        const companyPhone = isImportadora ? '2334354950' : '3157654321';
        const companyWeb = isImportadora ? 'Repuestoscajica.com' : 'clubsoldelvalle.com';
        const companyEmail = isImportadora ? 'contacto@repuestoscajica.com' : 'contacto@clubsoldelvalle.com';

        let itemsHtml = '';
        invoiceItems.forEach((item, idx) => {
            const qty = item.cantidad || 1;
            const price = item.precio;
            const sub = item.subtotal;
            itemsHtml += `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${item.product.codigo}</td>
                    <td>${item.product.descripcion}</td>
                    <td style="text-align: center;">${qty}</td>
                    <td style="text-align: right;">${formatMoney(price)}</td>
                    <td style="text-align: right;">${formatMoney(sub)}</td>
                </tr>
            `;
        });

        const premiumHtml = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap');
                
                .premium-invoice {
                    font-family: 'Inter', sans-serif;
                    color: #1e293b;
                    max-width: 800px;
                    margin: 0 auto;
                    background: #fff;
                    padding: 10px;
                }
                .premium-invoice h1, .premium-invoice h2, .premium-invoice h3, .premium-invoice .invoice-badge {
                    font-family: 'Outfit', sans-serif;
                }
                .invoice-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    border-bottom: 2px solid #0f172a;
                    padding-bottom: 15px;
                    margin-bottom: 20px;
                }
                .company-info {
                    flex: 1.2;
                }
                .company-name {
                    font-size: 24px;
                    font-weight: 800;
                    color: #0f172a;
                    margin: 0 0 5px 0;
                    letter-spacing: -0.5px;
                }
                .company-nit {
                    font-size: 13px;
                    color: #475569;
                    margin: 0 0 5px 0;
                }
                .company-info p {
                    font-size: 12px;
                    color: #475569;
                    margin: 2px 0;
                }
                .invoice-title-box {
                    text-align: right;
                    flex: 0.8;
                }
                .invoice-badge {
                    background-color: #ef4444;
                    color: #fff;
                    display: inline-block;
                    padding: 4px 12px;
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    border-radius: 4px;
                    margin-bottom: 8px;
                }
                .invoice-number {
                    font-size: 20px;
                    font-weight: 700;
                    color: #b91c1c;
                    margin-bottom: 10px;
                }
                .invoice-meta-grid {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 4px;
                    font-size: 11px;
                    text-align: right;
                }
                .invoice-meta-grid div {
                    color: #475569;
                }
                .invoice-meta-grid span {
                    color: #0f172a;
                    font-weight: 600;
                }
                .customer-section {
                    background-color: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    padding: 12px;
                    margin-bottom: 20px;
                }
                .section-title {
                    font-size: 11px;
                    font-weight: 700;
                    color: #475569;
                    border-bottom: 1px solid #e2e8f0;
                    padding-bottom: 4px;
                    margin: 0 0 8px 0;
                    letter-spacing: 0.5px;
                }
                .customer-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 6px 12px;
                    font-size: 12px;
                }
                .customer-grid div {
                    color: #475569;
                }
                .customer-grid span {
                    color: #0f172a;
                    font-weight: 500;
                }
                .invoice-items-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                }
                .invoice-items-table th {
                    background-color: #0f172a;
                    color: #ffffff;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    padding: 8px 10px;
                    text-align: left;
                }
                .invoice-items-table td {
                    padding: 8px 10px;
                    font-size: 12px;
                    border-bottom: 1px solid #e2e8f0;
                }
                .invoice-items-table tbody tr:nth-child(even) {
                    background-color: #f8fafc;
                }
                .invoice-bottom {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-top: 20px;
                    margin-bottom: 30px;
                }
                .bottom-left {
                    flex: 1.2;
                    margin-right: 20px;
                }
                .qr-container {
                    display: flex;
                    align-items: flex-start;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    padding: 10px;
                    background-color: #f8fafc;
                }
                .qr-placeholder {
                    width: 90px;
                    height: 90px;
                    border: 2px dashed #94a3b8;
                    border-radius: 4px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    text-align: center;
                    padding: 4px;
                    box-sizing: border-box;
                    margin-right: 12px;
                    flex-shrink: 0;
                    background-color: #fff;
                }
                .qr-icon {
                    font-size: 18px;
                    font-weight: 800;
                    color: #94a3b8;
                    margin-bottom: 4px;
                }
                .qr-placeholder span {
                    font-size: 8px;
                    color: #64748b;
                    font-weight: 600;
                    line-height: 1.1;
                }
                .qr-text {
                    flex: 1;
                }
                .qr-text p {
                    margin: 0;
                    font-size: 10px;
                    color: #334155;
                }
                .cufe-hash {
                    font-family: monospace;
                    font-size: 9px !important;
                    color: #475569 !important;
                    word-break: break-all;
                    background: #e2e8f0;
                    padding: 4px;
                    border-radius: 4px;
                    margin-top: 2px !important;
                }
                .bottom-right {
                    flex: 0.8;
                }
                .invoice-totals-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }
                .invoice-totals-table td {
                    padding: 6px 8px;
                    color: #475569;
                }
                .invoice-totals-table td.text-right {
                    text-align: right;
                    font-weight: 600;
                    color: #0f172a;
                }
                .grand-total-row {
                    border-top: 2px solid #0f172a;
                    font-size: 14px;
                    font-weight: 700;
                }
                .grand-total-row td {
                    color: #0f172a !important;
                    padding-top: 8px !important;
                }
                .grand-total-row td.text-right {
                    font-size: 16px;
                    color: #b91c1c !important;
                }
                .invoice-footer {
                    border-top: 1px solid #e2e8f0;
                    padding-top: 12px;
                    text-align: center;
                    font-size: 9px;
                    color: #94a3b8;
                    line-height: 1.4;
                }
                .invoice-footer p {
                    margin: 2px 0;
                }
                .capitalize {
                    text-transform: capitalize;
                }
            </style>
            <div class="premium-invoice">
                <div class="invoice-header">
                    <div class="company-info">
                        <h1 class="company-name">${companyName}</h1>
                        <p class="company-nit"><strong>NIT:</strong> ${companyNit}</p>
                        <p><strong>Dirección:</strong> ${companyAddress}</p>
                        <p><strong>WhatsApp:</strong> ${companyPhone} | <strong>Web:</strong> ${companyWeb}</p>
                        <p>Responsable de IVA - Previsualización de Facturación</p>
                        <p style="font-size: 8px; opacity: 0.85; font-style: italic; color: #475569; margin: 2px 0 0 0;">
                            ${isImportadora 
                                ? 'Autorización de Facturación DIAN No. 18764096884046 del 2025-08-11 | Prefijo: FVE | Rango: 1001 al 2000 | Vigencia: 24 meses'
                                : 'Autorización de Facturación DIAN No. 187640000001 de 2026-01-15 | Rango: FV-1 a FV-100000'}
                        </p>
                    </div>
                    <div class="invoice-title-box">
                        <div class="invoice-badge">PRE-FACTURA / BORRADOR</div>
                        <div class="invoice-number">${prefijo || 'FV'}-BORRADOR</div>
                        <div class="invoice-meta-grid">
                            <div><strong>Fecha Emisión:</strong> <span>${fecha}</span></div>
                            <div><strong>Fecha Vencimiento:</strong> <span>${fecha}</span></div>
                            <div><strong>Forma de Pago:</strong> <span class="capitalize">${pago}</span></div>
                            <div><strong>Estado Contable:</strong> <span>BORRADOR</span></div>
                        </div>
                    </div>
                </div>

                <div class="customer-section">
                    <h3 class="section-title">DATOS DEL ADQUIRIENTE (CLIENTE)</h3>
                    <div class="customer-grid">
                        <div><strong>Señor(es):</strong> <span>${customerName}</span></div>
                        <div><strong>NIT / CC:</strong> <span>${customerNit}</span></div>
                        <div><strong>Dirección:</strong> <span>${customerAddress}</span></div>
                        <div><strong>Ciudad / Municipio:</strong> <span>${customerCity}</span></div>
                        <div><strong>Teléfono:</strong> <span>${customerPhone}</span></div>
                        <div><strong>Email:</strong> <span>${customerEmail}</span></div>
                    </div>
                </div>

                <table class="invoice-items-table">
                    <thead>
                        <tr>
                            <th style="width: 5%;">#</th>
                            <th style="width: 15%;">SKU</th>
                            <th style="width: 45%;">Descripción del Producto</th>
                            <th style="text-align: center; width: 10%;">Cant.</th>
                            <th style="text-align: right; width: 12%;">Precio Unit.</th>
                            <th style="text-align: right; width: 13%;">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml || '<tr><td colspan="6" style="text-align:center;">No hay ítems agregados</td></tr>'}
                    </tbody>
                </table>

                <div class="invoice-bottom">
                    <div class="bottom-left">
                        <div class="qr-container">
                            <div class="qr-placeholder">
                                <div class="qr-icon"><i class="fa-solid fa-qrcode"></i></div>
                                <span>ESPACIO EXCLUSIVO QR DIAN</span>
                            </div>
                            <div class="qr-text">
                                <p><strong>CUFE / Firma Digital:</strong></p>
                                <p class="cufe-hash">PRE-FACTURA: Firma y QR se generarán al guardar el documento oficial</p>
                                <p style="margin-top: 5px; font-size: 8px; color: #64748b; line-height: 1.2;">
                                    Este documento es un borrador informativo para revisión del cliente y no posee validez fiscal hasta ser transmitido y firmado ante la DIAN.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="bottom-right">
                        <table class="invoice-totals-table">
                            <tr>
                                <td>Subtotal:</td>
                                <td class="text-right">${subtotal}</td>
                            </tr>
                            ${hasDiscount && discountValPrint !== '$0.00' && discountValPrint !== '-$0.00' && discountValPrint !== '-$0' ? `
                            <tr>
                                <td>Descuento:</td>
                                <td class="text-right" style="color: #b91c1c;">${discountValPrint}</td>
                            </tr>
                            ` : ''}
                            <tr>
                                <td>IVA (19%):</td>
                                <td class="text-right">${iva}</td>
                            </tr>
                            ${retefte !== '$0' && retefte !== '0' && retefte !== '' ? `
                            <tr>
                                <td>Retención Fuente:</td>
                                <td class="text-right">- ${retefte}</td>
                            </tr>
                            ` : ''}
                            ${reteica !== '$0' && reteica !== '0' && reteica !== '' ? `
                            <tr>
                                <td>Retención ICA:</td>
                                <td class="text-right">- ${reteica}</td>
                            </tr>
                            ` : ''}
                            <tr class="grand-total-row">
                                <td>TOTAL NETO:</td>
                                <td class="text-right">${total}</td>
                            </tr>
                        </table>
                    </div>
                </div>

                <div class="invoice-footer">
                    <p>Borrador generado mediante el software <strong>SIMPLIX ERP</strong></p>
                    <p>Soluciones Contables y de Facturación Electrónica para Colombia.</p>
                </div>
            </div>
        `;
        sendToPrinter(premiumHtml);
        return;
    } else if (docType === 'ds') {
        const provSearch = document.getElementById('com-proveedor-search').value;
        const fecha = document.getElementById('com-fecha').value;
        const pago = document.getElementById('com-pago').value;
        const concepto = document.getElementById('com-concepto').value;
        
        const subtotal = document.getElementById('com-tot-subtotal').innerText;
        const iva = document.getElementById('com-tot-iva').innerText;
        const retefte = document.getElementById('com-tot-retefte').innerText;
        const total = document.getElementById('com-tot-neto').innerText;
        
        let itemsHtml = '';
        purchaseItems.forEach(item => {
            itemsHtml += `
                <tr>
                    <td>${item.product.codigo}</td>
                    <td>${item.product.descripcion}</td>
                    <td class="text-right">${item.cantidad}</td>
                    <td class="text-right">${formatMoney(item.costo)}</td>
                    <td class="text-right">${formatMoney(item.subtotal)}</td>
                </tr>
            `;
        });
        
        let accHtml = '';
        const accRows = document.querySelectorAll('#ds-doc-accounting-table tbody tr');
        accRows.forEach(row => {
            if (row.cells.length >= 4 && !row.classList.contains('totals-row')) {
                accHtml += `
                    <tr>
                        <td>${row.cells[0].innerText}</td>
                        <td>${row.cells[1].innerText}</td>
                        <td class="text-right">${row.cells[2].innerText}</td>
                        <td class="text-right">${row.cells[3].innerText}</td>
                    </tr>
                `;
            }
        });
        
        html = `
            <div class="header">
                <h1>${tenantName}</h1>
                <p>NIT: ${tenantNit} | SIMPLIX ERP Adquisición</p>
                <p><strong>REGISTRO DE COMPRA / DOCUMENTO SOPORTE (BORRADOR)</strong></p>
            </div>
            
            <table class="meta-table">
                <tr>
                    <td class="label">Número:</td>
                    <td>DS-Borrador</td>
                    <td class="label">Fecha Emisión:</td>
                    <td>${fecha}</td>
                </tr>
                <tr>
                    <td class="label">Tercero / Proveedor:</td>
                    <td>${provSearch || 'General'}</td>
                    <td class="label">Forma de Pago:</td>
                    <td>${pago.toUpperCase()}</td>
                </tr>
                <tr>
                    <td class="label">Concepto General:</td>
                    <td colspan="3">${concepto || ''}</td>
                </tr>
            </table>
            
            <h3>Detalle de Adquisición</h3>
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Producto / Servicio</th>
                        <th class="text-right">Cant</th>
                        <th class="text-right">Costo Unit</th>
                        <th class="text-right">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml || '<tr><td colspan="5" style="text-align:center;">No hay items agregados</td></tr>'}
                </tbody>
            </table>
            
            <div class="totals-box">
                <div class="totals-row"><span>Subtotal:</span><span>${subtotal}</span></div>
                <div class="totals-row"><span>IVA (19%):</span><span>${iva}</span></div>
                <div class="totals-row"><span>Retención Fuente (2.5%):</span><span>${retefte}</span></div>
                <div class="totals-row grand-total"><span>Total a Pagar:</span><span>${total}</span></div>
            </div>
            
            <div class="accounting-section">
                <h3>Causación Contable (Asiento Diario)</h3>
                <table class="items-table">
                    <thead>
                        <tr>
                            <th>Cuenta PUC</th>
                            <th>Detalle Movimiento</th>
                            <th class="text-right">Débito</th>
                            <th class="text-right">Crédito</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${accHtml || '<tr><td colspan="4" style="text-align:center;">Sin causación</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    } else if (docType === 'ce') {
        const beneficiary = document.getElementById('ce-doc-beneficiario-search').value;
        const fecha = document.getElementById('ce-doc-fecha').value;
        const payAccount = document.getElementById('ce-doc-cuenta-pago').selectedOptions[0].text;
        const expenseAccount = document.getElementById('ce-doc-cuenta-gasto-search').value;
        const valor = document.getElementById('ce-doc-valor').value;
        const concepto = document.getElementById('ce-doc-concepto').value;
        
        let accHtml = '';
        const accRows = document.querySelectorAll('#ce-doc-accounting-table tbody tr');
        accRows.forEach(row => {
            if (row.cells.length >= 4 && !row.classList.contains('totals-row')) {
                accHtml += `
                    <tr>
                        <td>${row.cells[0].innerText}</td>
                        <td>${row.cells[1].innerText}</td>
                        <td class="text-right">${row.cells[2].innerText}</td>
                        <td class="text-right">${row.cells[3].innerText}</td>
                    </tr>
                `;
            }
        });
        
        html = `
            <div class="header">
                <h1>${tenantName}</h1>
                <p>NIT: ${tenantNit} | SIMPLIX ERP Tesorería</p>
                <p><strong>COMPROBANTE DE EGRESO (CE-BORRADOR)</strong></p>
            </div>
            
            <table class="meta-table">
                <tr>
                    <td class="label">Fecha:</td>
                    <td>${fecha}</td>
                    <td class="label">Pago desde:</td>
                    <td>${payAccount}</td>
                </tr>
                <tr>
                    <td class="label">Beneficiario:</td>
                    <td>${beneficiary || ''}</td>
                    <td class="label">Cuenta de Cargo:</td>
                    <td>${expenseAccount}</td>
                </tr>
                <tr>
                    <td class="label">Valor Egreso:</td>
                    <td style="font-weight:bold; font-size:15px; color:#1e40af;">${formatMoney(parseFloat(valor) || 0)}</td>
                    <td class="label">Concepto / Detalle:</td>
                    <td>${concepto}</td>
                </tr>
            </table>
            
            <div class="accounting-section">
                <h3>Contabilización Egreso</h3>
                <table class="items-table">
                    <thead>
                        <tr>
                            <th>Cuenta PUC</th>
                            <th>Tercero</th>
                            <th class="text-right">Débito</th>
                            <th class="text-right">Crédito</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${accHtml || '<tr><td colspan="4" style="text-align:center;">Sin causación</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    } else if (docType === 'rc') {
        const client = document.getElementById('rc-doc-cliente-search').value;
        const fecha = document.getElementById('rc-doc-fecha').value;
        const destAccount = document.getElementById('rc-doc-cuenta-destino').selectedOptions[0].text;
        const incomeAccount = document.getElementById('rc-doc-cuenta-ingreso-search').value;
        const valor = document.getElementById('rc-doc-valor').value;
        const concepto = document.getElementById('rc-doc-concepto').value;
        
        let accHtml = '';
        const accRows = document.querySelectorAll('#rc-doc-accounting-table tbody tr');
        accRows.forEach(row => {
            if (row.cells.length >= 4 && !row.classList.contains('totals-row')) {
                accHtml += `
                    <tr>
                        <td>${row.cells[0].innerText}</td>
                        <td>${row.cells[1].innerText}</td>
                        <td class="text-right">${row.cells[2].innerText}</td>
                        <td class="text-right">${row.cells[3].innerText}</td>
                    </tr>
                `;
            }
        });
        
        html = `
            <div class="header">
                <h1>${tenantName}</h1>
                <p>NIT: ${tenantNit} | SIMPLIX ERP Tesorería</p>
                <p><strong>RECIBO DE CAJA (RC-BORRADOR)</strong></p>
            </div>
            
            <table class="meta-table">
                <tr>
                    <td class="label">Fecha:</td>
                    <td>${fecha}</td>
                    <td class="label">Ingresar a:</td>
                    <td>${destAccount}</td>
                </tr>
                <tr>
                    <td class="label">Cliente:</td>
                    <td>${client || ''}</td>
                    <td class="label">Cuenta de Origen:</td>
                    <td>${incomeAccount}</td>
                </tr>
                <tr>
                    <td class="label">Valor Recibido:</td>
                    <td style="font-weight:bold; font-size:15px; color:#059669;">${formatMoney(parseFloat(valor) || 0)}</td>
                    <td class="label">Concepto / Detalle:</td>
                    <td>${concepto}</td>
                </tr>
            </table>
            
            <div class="accounting-section">
                <h3>Contabilización Recibo</h3>
                <table class="items-table">
                    <thead>
                        <tr>
                            <th>Cuenta PUC</th>
                            <th>Tercero</th>
                            <th class="text-right">Débito</th>
                            <th class="text-right">Crédito</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${accHtml || '<tr><td colspan="4" style="text-align:center;">Sin causación</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    } else if (docType === 'nm') {
        const employee = document.getElementById('nm-doc-empleado-search').value;
        const fecha = document.getElementById('nm-doc-fecha').value;
        const sueldo = document.getElementById('nm-doc-sueldo').value;
        const extras = document.getElementById('nm-doc-extras').value;
        const salud = document.getElementById('nm-doc-salud').value;
        const pension = document.getElementById('nm-doc-pension').value;
        const pago = document.getElementById('nm-doc-pago').selectedOptions[0].text;
        const concepto = document.getElementById('nm-doc-concepto').value;
        
        const devengado = document.getElementById('nm-tot-devengado').innerText;
        const deducciones = document.getElementById('nm-tot-deducciones').innerText;
        const neto = document.getElementById('nm-tot-neto').innerText;
        
        let accHtml = '';
        const accRows = document.querySelectorAll('#nm-doc-accounting-table tbody tr');
        accRows.forEach(row => {
            if (row.cells.length >= 4 && !row.classList.contains('totals-row')) {
                accHtml += `
                    <tr>
                        <td>${row.cells[0].innerText}</td>
                        <td>${row.cells[1].innerText}</td>
                        <td class="text-right">${row.cells[2].innerText}</td>
                        <td class="text-right">${row.cells[3].innerText}</td>
                    </tr>
                `;
            }
        });
        
        html = `
            <div class="header">
                <h1>${tenantName}</h1>
                <p>NIT: ${tenantNit} | SIMPLIX ERP Nómina</p>
                <p><strong>LIQUIDACIÓN DE NÓMINA INDIVIDUAL (BORRADOR)</strong></p>
            </div>
            
            <table class="meta-table">
                <tr>
                    <td class="label">Fecha Liquidación:</td>
                    <td>${fecha}</td>
                    <td class="label">Método Pago:</td>
                    <td>${pago}</td>
                </tr>
                <tr>
                    <td class="label">Trabajador:</td>
                    <td>${employee || ''}</td>
                    <td class="label">Concepto General:</td>
                    <td>${concepto}</td>
                </tr>
            </table>
            
            <table class="items-table" style="width: 50%; float:left; margin-bottom: 20px;">
                <thead>
                    <tr>
                        <th colspan="2">Devengados</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Sueldo Básico:</td><td class="text-right">${formatMoney(parseFloat(sueldo) || 0)}</td></tr>
                    <tr><td>Horas Extras/Recargos:</td><td class="text-right">${formatMoney(parseFloat(extras) || 0)}</td></tr>
                    <tr style="font-weight:bold;"><td>Total Devengado:</td><td class="text-right">${devengado}</td></tr>
                </tbody>
            </table>
            
            <table class="items-table" style="width: 48%; float:right; margin-bottom: 20px;">
                <thead>
                    <tr>
                        <th colspan="2">Deducciones</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Aporte Salud (4%):</td><td class="text-right">${formatMoney(parseFloat(salud) || 0)}</td></tr>
                    <tr><td>Aporte Pensión (4%):</td><td class="text-right">${formatMoney(parseFloat(pension) || 0)}</td></tr>
                    <tr style="font-weight:bold;"><td>Total Deducciones:</td><td class="text-right">${deducciones}</td></tr>
                </tbody>
            </table>
            
            <div style="clear:both;"></div>
            
            <div class="totals-box" style="float:none; width: 100%; border:1px solid #ccc; padding: 10px; border-radius:5px; margin-bottom: 25px;">
                <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:16px;">
                    <span>NETO A PAGAR:</span>
                    <span style="color:#8b5cf6;">${neto}</span>
                </div>
            </div>
            
            <div class="accounting-section">
                <h3>Causación Contable Nómina</h3>
                <table class="items-table">
                    <thead>
                        <tr>
                            <th>Cuenta PUC</th>
                            <th>Tercero</th>
                            <th class="text-right">Débito</th>
                            <th class="text-right">Crédito</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${accHtml || '<tr><td colspan="4" style="text-align:center;">Sin causación</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    } else if (docType === 'nc') {
        const concepto = document.getElementById('nc-doc-concepto').value;
        const fecha = document.getElementById('nc-doc-fecha').value;
        
        const debits = document.getElementById('nc-stat-debits').innerText;
        const credits = document.getElementById('nc-stat-credits').innerText;
        const diff = document.getElementById('nc-stat-diff').innerText;
        
        let accHtml = '';
        ncRows.forEach((r, idx) => {
            if (r.cuenta_codigo) {
                const accName = document.getElementById(`nc-puc-search-${idx}`).value.split(' - ')[1] || 'Cuenta';
                const tercName = document.getElementById(`nc-tercero-search-${idx}`).value || '';
                accHtml += `
                    <tr>
                        <td><strong>${r.cuenta_codigo}</strong> - ${accName}</td>
                        <td>${tercName}</td>
                        <td>${r.concepto_linea}</td>
                        <td class="text-right">${r.debito > 0 ? formatMoney(r.debito) : ''}</td>
                        <td class="text-right">${r.credito > 0 ? formatMoney(r.credito) : ''}</td>
                    </tr>
                `;
            }
        });
        
        html = `
            <div class="header">
                <h1>${tenantName}</h1>
                <p>NIT: ${tenantNit} | SIMPLIX ERP Asiento General</p>
                <p><strong>NOTA DE CONTABILIDAD (NC-BORRADOR)</strong></p>
            </div>
            
            <table class="meta-table">
                <tr>
                    <td class="label">Fecha Asiento:</td>
                    <td>${fecha}</td>
                    <td class="label">Concepto General:</td>
                    <td>${concepto}</td>
                </tr>
            </table>
            
            <h3>Movimientos Contables (Asiento de Diario)</h3>
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Cuenta PUC</th>
                        <th>Tercero / Nit</th>
                        <th>Detalle de Línea</th>
                        <th class="text-right">Débito</th>
                        <th class="text-right">Crédito</th>
                    </tr>
                </thead>
                <tbody>
                    ${accHtml || '<tr><td colspan="5" style="text-align:center;">No hay líneas en la nota</td></tr>'}
                </tbody>
            </table>
            
            <div class="totals-box">
                <div class="totals-row"><span>Total Débitos:</span><span>${debits}</span></div>
                <div class="totals-row"><span>Total Créditos:</span><span>${credits}</span></div>
                <div class="totals-row grand-total"><span>Diferencia:</span><span>${diff}</span></div>
            </div>
        `;
    }
    
    sendToPrinter(html);
}

async function printConsultedDocument(id) {
    try {
        const data = await fetchApi(`/${activeTenant}/asientos/detalles/${id}`);
        
        if (data.header.tipo_documento === 'FV') {
            const isImportadora = activeTenant === 'importadora';
            const companyName = isImportadora ? 'IMPORTADORA KYH SAS' : 'CLUB SOL DEL VALLE';
            const companyNit = isImportadora ? '901785745-5' : '800.987.654-3';
            const companyAddress = isImportadora ? 'Carrera 6 # 0 - 56 Cajica' : 'Kilómetro 4 Vía al Mar, Cali';
            const companyPhone = isImportadora ? '2334354950' : '3157654321';
            const companyWeb = isImportadora ? 'Repuestoscajica.com' : 'clubsoldelvalle.com';
            const companyEmail = isImportadora ? 'contacto@repuestoscajica.com' : 'contacto@clubsoldelvalle.com';

            const customerLine = data.details.find(d => d.tercero_nit) || {};
            const customerName = customerLine.tercero_nombre || 'Cliente General';
            const customerNit = customerLine.tercero_nit || 'S/D';
            const customerAddress = customerLine.tercero_direccion || 'No Registrada';
            const customerCity = customerLine.tercero_ciudad || 'Cajicá';
            const customerPhone = customerLine.tercero_telefono || 'S/D';
            const customerEmail = customerLine.tercero_email || 'S/D';

            const items = data.details.filter(d => d.cuenta_codigo && d.cuenta_codigo.startsWith('41') && d.cuenta_codigo !== '4175');
            
            let itemsHtml = '';
            let subtotalVal = 0;
            items.forEach((item, idx) => {
                const qty = item.cantidad || 1;
                const price = item.precio_unitario || item.credito;
                const sub = item.credito || (qty * price);
                subtotalVal += sub;
                itemsHtml += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td>${item.producto_sku || 'S/D'}</td>
                        <td>${item.producto_descripcion || item.concepto_linea || 'Producto'}</td>
                        <td style="text-align: center;">${qty}</td>
                        <td style="text-align: right;">${formatMoney(price)}</td>
                        <td style="text-align: right;">${formatMoney(sub)}</td>
                    </tr>
                `;
            });

            const ivaLine = data.details.find(d => d.cuenta_codigo === '2408');
            const totalIvaVal = ivaLine ? ivaLine.credito : 0;

            const reteFteLine = data.details.find(d => d.cuenta_codigo.startsWith('13') && d.concepto_linea && d.concepto_linea.toLowerCase().includes('fuente'));
            const totalReteFte = reteFteLine ? reteFteLine.debito : 0;

            const reteIcaLine = data.details.find(d => d.cuenta_codigo.startsWith('13') && d.concepto_linea && d.concepto_linea.toLowerCase().includes('ica'));
            const totalReteIca = reteIcaLine ? reteIcaLine.debito : 0;

            const totalNetVal = data.header.total_documento;
            
            const paymentMethod = data.header.concepto && data.header.concepto.toLowerCase().includes('efectivo') ? 'efectivo' : 
                                  (data.header.concepto && data.header.concepto.toLowerCase().includes('bancolombia') ? 'bancolombia' : 
                                  (data.header.concepto && data.header.concepto.toLowerCase().includes('nequi') ? 'nequi' : 'crédito'));

            const docTitle = data.header.tipo_documento === 'FV' ? 'FACTURA DE VENTA ELECTRÓNICA' : 'FACTURA DE VENTA';

            const premiumHtml = `
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap');
                    
                    .premium-invoice {
                        font-family: 'Inter', sans-serif;
                        color: #1e293b;
                        max-width: 800px;
                        margin: 0 auto;
                        background: #fff;
                        padding: 10px;
                    }
                    .premium-invoice h1, .premium-invoice h2, .premium-invoice h3, .premium-invoice .invoice-badge {
                        font-family: 'Outfit', sans-serif;
                    }
                    .invoice-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        border-bottom: 2px solid #0f172a;
                        padding-bottom: 15px;
                        margin-bottom: 20px;
                    }
                    .company-info {
                        flex: 1.2;
                    }
                    .company-name {
                        font-size: 24px;
                        font-weight: 800;
                        color: #0f172a;
                        margin: 0 0 5px 0;
                        letter-spacing: -0.5px;
                    }
                    .company-nit {
                        font-size: 13px;
                        color: #475569;
                        margin: 0 0 5px 0;
                    }
                    .company-info p {
                        font-size: 12px;
                        color: #475569;
                        margin: 2px 0;
                    }
                    .invoice-title-box {
                        text-align: right;
                        flex: 0.8;
                    }
                    .invoice-badge {
                        background-color: #0f172a;
                        color: #fff;
                        display: inline-block;
                        padding: 4px 12px;
                        font-size: 11px;
                        font-weight: 700;
                        text-transform: uppercase;
                        border-radius: 4px;
                        margin-bottom: 8px;
                    }
                    .invoice-number {
                        font-size: 20px;
                        font-weight: 700;
                        color: #1e3a8a;
                        margin-bottom: 10px;
                    }
                    .invoice-meta-grid {
                        display: grid;
                        grid-template-columns: 1fr;
                        gap: 4px;
                        font-size: 11px;
                        text-align: right;
                    }
                    .invoice-meta-grid div {
                        color: #475569;
                    }
                    .invoice-meta-grid span {
                        color: #0f172a;
                        font-weight: 600;
                    }
                    .customer-section {
                        background-color: #f8fafc;
                        border: 1px solid #e2e8f0;
                        border-radius: 6px;
                        padding: 12px;
                        margin-bottom: 20px;
                    }
                    .section-title {
                        font-size: 11px;
                        font-weight: 700;
                        color: #475569;
                        border-bottom: 1px solid #e2e8f0;
                        padding-bottom: 4px;
                        margin: 0 0 8px 0;
                        letter-spacing: 0.5px;
                    }
                    .customer-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 6px 12px;
                        font-size: 12px;
                    }
                    .customer-grid div {
                        color: #475569;
                    }
                    .customer-grid span {
                        color: #0f172a;
                        font-weight: 500;
                    }
                    .invoice-items-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 20px;
                    }
                    .invoice-items-table th {
                        background-color: #0f172a;
                        color: #ffffff;
                        font-size: 11px;
                        font-weight: 600;
                        text-transform: uppercase;
                        padding: 8px 10px;
                        text-align: left;
                    }
                    .invoice-items-table td {
                        padding: 8px 10px;
                        font-size: 12px;
                        border-bottom: 1px solid #e2e8f0;
                    }
                    .invoice-items-table tbody tr:nth-child(even) {
                        background-color: #f8fafc;
                    }
                    .invoice-bottom {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        margin-top: 20px;
                        margin-bottom: 30px;
                    }
                    .bottom-left {
                        flex: 1.2;
                        margin-right: 20px;
                    }
                    .qr-container {
                        display: flex;
                        align-items: flex-start;
                        border: 1px solid #e2e8f0;
                        border-radius: 6px;
                        padding: 10px;
                        background-color: #f8fafc;
                    }
                    .qr-placeholder {
                        width: 90px;
                        height: 90px;
                        border: 2px dashed #94a3b8;
                        border-radius: 4px;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        text-align: center;
                        padding: 4px;
                        box-sizing: border-box;
                        margin-right: 12px;
                        flex-shrink: 0;
                        background-color: #fff;
                    }
                    .qr-icon {
                        font-size: 18px;
                        font-weight: 800;
                        color: #94a3b8;
                        margin-bottom: 4px;
                    }
                    .qr-placeholder span {
                        font-size: 8px;
                        color: #64748b;
                        font-weight: 600;
                        line-height: 1.1;
                    }
                    .qr-text {
                        flex: 1;
                    }
                    .qr-text p {
                        margin: 0;
                        font-size: 10px;
                        color: #334155;
                    }
                    .cufe-hash {
                        font-family: monospace;
                        font-size: 9px !important;
                        color: #475569 !important;
                        word-break: break-all;
                        background: #e2e8f0;
                        padding: 4px;
                        border-radius: 4px;
                        margin-top: 2px !important;
                    }
                    .bottom-right {
                        flex: 0.8;
                    }
                    .invoice-totals-table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 12px;
                    }
                    .invoice-totals-table td {
                        padding: 6px 8px;
                        color: #475569;
                    }
                    .invoice-totals-table td.text-right {
                        text-align: right;
                        font-weight: 600;
                        color: #0f172a;
                    }
                    .grand-total-row {
                        border-top: 2px solid #0f172a;
                        font-size: 14px;
                        font-weight: 700;
                    }
                    .grand-total-row td {
                        color: #0f172a !important;
                        padding-top: 8px !important;
                    }
                    .grand-total-row td.text-right {
                        font-size: 16px;
                        color: #1e3a8a !important;
                    }
                    .invoice-footer {
                        border-top: 1px solid #e2e8f0;
                        padding-top: 12px;
                        text-align: center;
                        font-size: 9px;
                        color: #94a3b8;
                        line-height: 1.4;
                    }
                    .invoice-footer p {
                        margin: 2px 0;
                    }
                    .capitalize {
                        text-transform: capitalize;
                    }
                </style>
                <div class="premium-invoice">
                    <div class="invoice-header">
                        <div class="company-info">
                            <h1 class="company-name">${companyName}</h1>
                            <p class="company-nit"><strong>NIT:</strong> ${companyNit}</p>
                            <p><strong>Dirección:</strong> ${companyAddress}</p>
                            <p><strong>WhatsApp:</strong> ${companyPhone} | <strong>Web:</strong> ${companyWeb}</p>
                            <p>Responsable de IVA - Facturación Electrónica DIAN</p>
                            <p style="font-size: 8px; opacity: 0.85; font-style: italic; color: #475569; margin: 2px 0 0 0;">
                                ${isImportadora 
                                    ? 'Autorización de Facturación DIAN No. 18764096884046 del 2025-08-11 | Prefijo: FVE | Rango: 1001 al 2000 | Vigencia: 24 meses'
                                    : 'Autorización de Facturación DIAN No. 187640000001 de 2026-01-15 | Rango: FV-1 a FV-100000'}
                            </p>
                        </div>
                        <div class="invoice-title-box">
                            <div class="invoice-badge">${docTitle}</div>
                            <div class="invoice-number">${data.header.prefijo || 'FV'}-${data.header.numero}</div>
                            <div class="invoice-meta-grid">
                                <div><strong>Fecha Emisión:</strong> <span>${data.header.fecha}</span></div>
                                <div><strong>Fecha Vencimiento:</strong> <span>${data.header.fecha}</span></div>
                                <div><strong>Forma de Pago:</strong> <span class="capitalize">${paymentMethod}</span></div>
                                <div><strong>Estado Contable:</strong> <span>${data.header.anulado === 1 ? '<span style="color:red;">ANULADO</span>' : 'VIGENTE'}</span></div>
                            </div>
                        </div>
                    </div>

                    <div class="customer-section">
                        <h3 class="section-title">DATOS DEL ADQUIRIENTE (CLIENTE)</h3>
                        <div class="customer-grid">
                            <div><strong>Señor(es):</strong> <span>${customerName}</span></div>
                            <div><strong>NIT / CC:</strong> <span>${customerNit}</span></div>
                            <div><strong>Dirección:</strong> <span>${customerAddress}</span></div>
                            <div><strong>Ciudad / Municipio:</strong> <span>${customerCity}</span></div>
                            <div><strong>Teléfono:</strong> <span>${customerPhone}</span></div>
                            <div><strong>Email:</strong> <span>${customerEmail}</span></div>
                        </div>
                    </div>

                    <table class="invoice-items-table">
                        <thead>
                            <tr>
                                <th style="width: 5%;">#</th>
                                <th style="width: 15%;">SKU</th>
                                <th style="width: 45%;">Descripción del Producto</th>
                                <th style="text-align: center; width: 10%;">Cant.</th>
                                <th style="text-align: right; width: 12%;">Precio Unit.</th>
                                <th style="text-align: right; width: 13%;">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                    </table>

                    <div class="invoice-bottom">
                        <div class="bottom-left">
                            <div class="qr-container">
                                <div class="qr-placeholder">
                                    <div class="qr-icon"><i class="fa-solid fa-qrcode"></i></div>
                                    <span>ESPACIO EXCLUSIVO QR DIAN</span>
                                </div>
                                <div class="qr-text">
                                    <p><strong>CUFE / Firma Digital:</strong></p>
                                    <p class="cufe-hash">${data.header.dian_cufe || 'Pendiente de transmisión a la DIAN (Borrador / Modo Contingencia)'}</p>
                                    <p style="margin-top: 5px; font-size: 8px; color: #64748b; line-height: 1.2;">
                                        Esta factura se asimila en todos sus efectos a una letra de cambio en los términos del Artículo 774 del Código de Comercio.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div class="bottom-right">
                            <table class="invoice-totals-table">
                                <tr>
                                    <td>Subtotal:</td>
                                    <td class="text-right">${formatMoney(subtotalVal)}</td>
                                </tr>
                                <tr>
                                    <td>IVA (19%):</td>
                                    <td class="text-right">${formatMoney(totalIvaVal)}</td>
                                </tr>
                                ${totalReteFte > 0 ? `
                                <tr>
                                    <td>Retención Fuente (2.5%):</td>
                                    <td class="text-right">- ${formatMoney(totalReteFte)}</td>
                                </tr>
                                ` : ''}
                                ${totalReteIca > 0 ? `
                                <tr>
                                    <td>Retención ICA:</td>
                                    <td class="text-right">- ${formatMoney(totalReteIca)}</td>
                                </tr>
                                ` : ''}
                                <tr class="grand-total-row">
                                    <td>TOTAL NETO:</td>
                                    <td class="text-right">${formatMoney(totalNetVal)}</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    <div class="invoice-footer">
                        <p>Facturado electrónicamente mediante el software <strong>SIMPLIX ERP</strong></p>
                        <p>Soluciones Contables y de Facturación Electrónica para Colombia.</p>
                    </div>
                </div>
            `;
            sendToPrinter(premiumHtml);
            return;
        }

        const tenantName = activeTenant === 'importadora' ? 'IMPORTADORA KYH SAS' : 'CLUB SOL DEL VALLE';
        const tenantNit = activeTenant === 'importadora' ? '901785745-5' : '800.987.654-3';
        
        let accHtml = '';
        let totalDeb = 0;
        let totalCre = 0;
        
        data.details.forEach(d => {
            totalDeb += d.debito;
            totalCre += d.credito;
            accHtml += `
                <tr>
                    <td><strong>${d.cuenta_codigo}</strong> - ${subaccountName(d.cuenta_codigo, d.cuenta_nombre)}</td>
                    <td>${d.tercero_nombre || ''}</td>
                    <td>${d.concepto_linea || ''}</td>
                    <td class="text-right">${d.debito > 0 ? formatMoney(d.debito) : ''}</td>
                    <td class="text-right">${d.credito > 0 ? formatMoney(d.credito) : ''}</td>
                </tr>
            `;
        });
        
        const documentTypeNames = {
            'FV': 'FACTURA DE VENTA ELECTRÓNICA',
            'DS': 'DOCUMENTO SOPORTE EN ADQUISICIONES',
            'CE': 'COMPROBANTE DE EGRESO',
            'RC': 'RECIBO DE CAJA',
            'NM': 'LIQUIDACIÓN DE NÓMINA INDIVIDUAL',
            'NC': 'NOTA DE CONTABILIDAD'
        };
        
        const docTypeName = documentTypeNames[data.header.tipo_documento] || 'ASIENTO CONTABLE';
        
        const html = `
            <div class="header">
                <h1>${tenantName}</h1>
                <p>NIT: ${tenantNit} | SIMPLIX ERP Registro Oficial</p>
                <p><strong>${docTypeName}</strong></p>
            </div>
            
            <table class="meta-table">
                <tr>
                    <td class="label">Documento:</td>
                    <td><strong>${data.header.tipo_documento}-${data.header.numero}</strong></td>
                    <td class="label">Fecha Contable:</td>
                    <td>${data.header.fecha}</td>
                </tr>
                <tr>
                    <td class="label">Concepto General:</td>
                    <td colspan="3">${data.header.concepto}</td>
                </tr>
                <tr>
                    <td class="label">Estado Contable:</td>
                    <td>${data.header.anulado === 1 ? '<span style="color:red; font-weight:bold;">ANULADO</span>' : 'VIGENTE'}</td>
                    <td class="label">Registrado por:</td>
                    <td>${data.header.creado_por}</td>
                </tr>
                ${data.header.dian_cufe ? `
                <tr>
                    <td class="label">CUFE / Firma:</td>
                    <td colspan="3" style="font-family:monospace; font-size:10px; word-break:break-all;">${data.header.dian_cufe}</td>
                </tr>
                ` : ''}
            </table>
            
            <h3>Detalle de Asiento Contable (Partida Doble)</h3>
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Cuenta PUC</th>
                        <th>Tercero / Empleado</th>
                        <th>Descripción Movimiento</th>
                        <th class="text-right">Débito</th>
                        <th class="text-right">Crédito</th>
                    </tr>
                </thead>
                <tbody>
                    ${accHtml}
                </tbody>
            </table>
            
            <div class="totals-box">
                <div class="totals-row"><span>Total Débitos:</span><span>${formatMoney(totalDeb)}</span></div>
                <div class="totals-row"><span>Total Créditos:</span><span>${formatMoney(totalCre)}</span></div>
                <div class="totals-row grand-total"><span>Diferencia:</span><span>${formatMoney(totalDeb - totalCre)}</span></div>
            </div>
        `;
        
        sendToPrinter(html);
        
    } catch(err) {
        alert('Error al generar impresión: ' + err.message);
    }
}

function subaccountName(code, fallback) {
    const matched = cachePuc.find(p => p.codigo === code);
    return matched ? matched.nombre : fallback;
}

// AUTHENTICATION AND LOGOUT
async function submitLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    
    errorEl.style.display = 'none';
    
    try {
        const res = await fetchApi('/login', {
            method: 'POST',
            body: { username, password }
        });
        
        if (res.success) {
            localStorage.setItem('currentUser', JSON.stringify(res.user));
            initializeAppAfterLogin(res.user);
        } else {
            errorEl.innerText = res.error || 'Credenciales inválidas';
            errorEl.style.display = 'block';
        }
    } catch (err) {
        errorEl.innerText = err.message || 'Error de conexión';
        errorEl.style.display = 'block';
    }
}

function logout() {
    localStorage.removeItem('currentUser');
    document.getElementById('login-container').style.display = 'flex';
    document.querySelector('.app-container').style.display = 'none';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    window.location.reload(); // Refresh page to clear state completely
}

// GESTIÓN DE USUARIOS
let cacheUsuarios = [];

async function loadUsuarios() {
    try {
        const data = await fetchApi(`/${activeTenant}/users`);
        cacheUsuarios = data;
        renderUsuariosList(data);
    } catch (err) {
        console.error('Error al cargar usuarios:', err);
    }
}

function renderUsuariosList(users) {
    const tbody = document.getElementById('usuarios-table-body');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No hay usuarios registrados.</td></tr>';
        return;
    }
    
    users.forEach(u => {
        const tr = document.createElement('tr');
        const statusClass = u.active ? 'active' : 'inactive';
        const statusText = u.active ? 'Activo' : 'Inactivo';
        const toggleIcon = u.active ? 'fa-user-slash' : 'fa-user-check';
        const toggleTitle = u.active ? 'Desactivar' : 'Activar';
        
        tr.innerHTML = `
            <td><strong>${u.username}</strong></td>
            <td>${u.full_name}</td>
            <td>${u.identificacion || '-'}</td>
            <td><span class="role-badge ${u.role}" style="padding:4px 8px; border-radius:4px; font-size:0.8rem; font-weight:600; text-transform:uppercase;">${u.role}</span></td>
            <td style="text-align:right;">${formatMoney(u.sueldo || 0)}</td>
            <td style="text-align:center;"><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td style="text-align:center;">
                <div style="display:flex; justify-content:center; gap:8px;">
                    <button class="btn btn-secondary btn-sm" onclick="editUsuario('${u.username}')" title="Editar" style="padding:4px 8px; font-size:0.8rem;">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="toggleUserActive(${u.id})" title="${toggleTitle}" style="padding:4px 8px; font-size:0.8rem;">
                        <i class="fa-solid ${toggleIcon}"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function submitNewUsuario(e) {
    e.preventDefault();
    
    const isEdit = document.getElementById('u-is-edit').value === 'true';
    const username = document.getElementById('u-username').value.trim();
    const password = document.getElementById('u-password').value;
    const nombre = document.getElementById('u-nombre').value.trim();
    const apellidos = document.getElementById('u-apellidos').value.trim();
    const tipo_doc = document.getElementById('u-tipo-doc').value;
    const identificacion = document.getElementById('u-doc').value.trim();
    const role = document.getElementById('u-role').value;
    const sueldo = parseFloat(document.getElementById('u-sueldo').value) || 0;
    const email = document.getElementById('u-email').value.trim();
    const telefono = document.getElementById('u-telefono').value.trim();
    const direccion = document.getElementById('u-direccion').value.trim();
    const ciudad = document.getElementById('u-ciudad').value.trim();
    
    if (!isEdit && !password) {
        alert('Por favor, ingresa una contraseña para el nuevo usuario.');
        return;
    }
    
    const body = {
        username,
        password: password || undefined,
        full_name: `${nombre} ${apellidos}`,
        tipo_identificacion: tipo_doc,
        identificacion,
        role,
        sueldo,
        email,
        telefono,
        direccion,
        ciudad,
        usuario: currentUserId
    };
    
    try {
        const res = await fetchApi(`/${activeTenant}/users`, {
            method: 'POST',
            body
        });
        
        if (res.success) {
            alert(isEdit ? 'Usuario actualizado con éxito.' : 'Usuario inscrito con éxito.');
            closeModal('usuario-modal');
            loadUsuarios();
            
            // Reload local terceros cache immediately so autocomplete is updated
            fetchApi(`/${activeTenant}/terceros`).then(data => cacheTerceros = data);
        } else {
            alert('Error: ' + res.error);
        }
    } catch (err) {
        alert('Error al registrar usuario: ' + err.message);
    }
}

async function toggleUserActive(userId) {
    try {
        const res = await fetchApi(`/${activeTenant}/users/toggle-active/${userId}`, {
            method: 'POST',
            body: { usuario: currentUserId }
        });
        if (res.success) {
            loadUsuarios();
        }
    } catch (err) {
        alert('Error al cambiar estado del usuario: ' + err.message);
    }
}

function openNewUsuarioModal() {
    document.getElementById('u-is-edit').value = 'false';
    document.getElementById('u-username').value = '';
    document.getElementById('u-username').readOnly = false;
    document.getElementById('u-password').value = '';
    document.getElementById('u-password').placeholder = '••••••••';
    document.getElementById('u-password').required = true;
    document.getElementById('u-nombre').value = '';
    document.getElementById('u-apellidos').value = '';
    document.getElementById('u-doc').value = '';
    document.getElementById('u-sueldo').value = 1300000;
    document.getElementById('u-email').value = '';
    document.getElementById('u-telefono').value = '';
    document.getElementById('u-direccion').value = '';
    
    // Clear and show third-party autocomplete
    document.getElementById('u-tercero-search').value = '';
    document.getElementById('u-tercero-id').value = '';
    document.getElementById('u-tercero-search-row').style.display = 'flex';
    
    showModal('usuario-modal');
}

function editUsuario(username) {
    const u = cacheUsuarios.find(user => user.username === username);
    if (!u) return;
    
    document.getElementById('u-is-edit').value = 'true';
    document.getElementById('u-username').value = u.username;
    document.getElementById('u-username').readOnly = true;
    document.getElementById('u-password').placeholder = '•••••••• (Vacío para mantener)';
    document.getElementById('u-password').required = false;
    
    // Split full name if possible
    const names = u.full_name.split(' ');
    const firstName = names[0] || '';
    const lastName = names.slice(1).join(' ') || '';
    
    document.getElementById('u-nombre').value = firstName;
    document.getElementById('u-apellidos').value = lastName;
    
    document.getElementById('u-tipo-doc').value = 'CC';
    document.getElementById('u-doc').value = u.identificacion || '';
    document.getElementById('u-role').value = u.role;
    document.getElementById('u-sueldo').value = u.sueldo || 0;
    document.getElementById('u-email').value = u.email || '';
    document.getElementById('u-telefono').value = u.telefono || '';
    document.getElementById('u-direccion').value = u.direccion || '';
    document.getElementById('u-ciudad').value = u.ciudad || 'Bogotá';
    
    // Hide third-party autocomplete when editing
    document.getElementById('u-tercero-search').value = '';
    document.getElementById('u-tercero-id').value = '';
    document.getElementById('u-tercero-search-row').style.display = 'none';
    
    showModal('usuario-modal');
}

clearAutocompleteFields();

function setupValidationWarnings() {
    const tDocInput = document.getElementById('t-doc');
    if (tDocInput) {
        tDocInput.addEventListener('input', () => {
            const doc = tDocInput.value.trim();
            const alertEl = document.getElementById('t-doc-alert');
            if (!doc) {
                alertEl.style.display = 'none';
                return;
            }
            const exists = cacheTerceros.find(t => t.identificacion === doc);
            if (exists) {
                alertEl.innerText = `⚠️ Identificación ya existe: ${exists.nombre}`;
                alertEl.style.display = 'block';
            } else {
                alertEl.style.display = 'none';
            }
        });
    }

    const tNombreInput = document.getElementById('t-nombre');
    if (tNombreInput) {
        tNombreInput.addEventListener('input', () => {
            const name = tNombreInput.value.trim().toLowerCase();
            const alertEl = document.getElementById('t-nombre-alert');
            if (!name) {
                alertEl.style.display = 'none';
                return;
            }
            const exists = cacheTerceros.find(t => t.nombre && String(t.nombre).toLowerCase().includes(name));
            if (exists && String(exists.nombre).toLowerCase() === name) {
                alertEl.innerText = `⚠️ Ya existe un tercero con el nombre: ${exists.nombre}`;
                alertEl.style.display = 'block';
            } else {
                alertEl.style.display = 'none';
            }
        });
    }

    const uUsernameInput = document.getElementById('u-username');
    if (uUsernameInput) {
        uUsernameInput.addEventListener('input', () => {
            const isEdit = document.getElementById('u-is-edit').value === 'true';
            if (isEdit) return;
            const username = uUsernameInput.value.trim().toLowerCase();
            const alertEl = document.getElementById('u-username-alert');
            if (!username) {
                alertEl.style.display = 'none';
                return;
            }
            const exists = cacheUsuarios.find(u => u.username.toLowerCase() === username);
            if (exists) {
                alertEl.innerText = `⚠️ Usuario ya existe: ${exists.full_name}`;
                alertEl.style.display = 'block';
            } else {
                alertEl.style.display = 'none';
            }
        });
    }

    const uDocInput = document.getElementById('u-doc');
    if (uDocInput) {
        uDocInput.addEventListener('input', () => {
            const isEdit = document.getElementById('u-is-edit').value === 'true';
            const doc = uDocInput.value.trim();
            const alertEl = document.getElementById('u-doc-alert');
            if (!doc) {
                alertEl.style.display = 'none';
                return;
            }
            const currentUsername = document.getElementById('u-username').value.trim().toLowerCase();
            const exists = cacheUsuarios.find(u => u.identificacion === doc && (!isEdit || u.username.toLowerCase() !== currentUsername));
            if (exists) {
                alertEl.innerText = `⚠️ Cédula ya registrada: ${exists.full_name} (${exists.username})`;
                alertEl.style.display = 'block';
            } else {
                alertEl.style.display = 'none';
            }
        });
    }
}

function lookupDIANRUES() {
    const doc = document.getElementById('t-doc').value.trim();
    if (!doc) {
        alert('Por favor, ingresa el número de documento/NIT primero.');
        return;
    }
    alert(`Redireccionando al portal oficial RUES para verificar los datos de la identificación: ${doc}`);
    window.open(`https://www.rues.org.co/`, '_blank');
}

// ==========================================================================
// SECCIÓN: INTEGRACIÓN MERCADO LIBRE
// ==========================================================================
async function loadConfigView() {
    try {
        const accounts = await fetchApi(`/${activeTenant}/mercadolibre/accounts`);
        
        // Reset inputs and status badges
        document.getElementById('ml-client-id-1').value = '';
        document.getElementById('ml-client-secret-1').value = '';
        document.getElementById('ml-status-1').innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #94a3b8;"></i> Desconectada';
        
        document.getElementById('ml-client-id-2').value = '';
        document.getElementById('ml-client-secret-2').value = '';
        document.getElementById('ml-status-2').innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #94a3b8;"></i> Desconectada';
        
        accounts.forEach(acc => {
            if (acc.account_name === 'Cuenta 1') {
                document.getElementById('ml-client-id-1').value = acc.client_id || '';
                if (acc.active) {
                    document.getElementById('ml-status-1').innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #22c55e;"></i> Vinculada (Vendedor: ' + (acc.seller_id || 'Activo') + ')';
                }
            } else if (acc.account_name === 'Cuenta 2') {
                document.getElementById('ml-client-id-2').value = acc.client_id || '';
                if (acc.active) {
                    document.getElementById('ml-status-2').innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #22c55e;"></i> Vinculada (Vendedor: ' + (acc.seller_id || 'Activo') + ')';
                }
            }
        });
        
        // Load sales history
        await loadMercadoLibreSales();
    } catch (err) {
        console.error('Error loading Mercado Libre accounts:', err);
    }
}

async function setupAndLinkMLAccount(accountName, index) {
    const clientId = document.getElementById(`ml-client-id-${index}`).value.trim();
    const clientSecret = document.getElementById(`ml-client-secret-${index}`).value.trim();
    
    if (!clientId || !clientSecret) {
        alert('Por favor, ingresa el Client ID y el Client Secret.');
        return;
    }
    
    try {
        const res = await fetchApi(`/${activeTenant}/mercadolibre/setup`, {
            method: 'POST',
            body: { account_name: accountName, client_id: clientId, client_secret: clientSecret }
        });
        
        if (res.success && res.id) {
            const urlRes = await fetchApi(`/mercadolibre/auth-url?id=${res.id}`);
            if (urlRes.authUrl) {
                window.location.href = urlRes.authUrl;
            } else {
                alert('No se pudo generar la URL de vinculación.');
            }
        } else {
            alert('Error al guardar credenciales: ' + res.error);
        }
    } catch (err) {
        alert('Falla al configurar cuenta: ' + err.message);
    }
}

async function unifyMercadoLibreInventory() {
    const resultsBox = document.getElementById('ml-unify-results');
    const summaryBox = document.getElementById('ml-unify-stats-summary');
    const logBox = document.getElementById('ml-unify-stats-log');
    
    resultsBox.style.display = 'block';
    summaryBox.innerHTML = '<span style="color:var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Sincronizando unificación de inventario...</span>';
    logBox.innerHTML = '';
    
    try {
        const res = await fetchApi(`/${activeTenant}/mercadolibre/unify-skus`, {
            method: 'POST',
            body: { usuario: currentUserId }
        });
        
        if (res.success && res.stats) {
            const stats = res.stats;
            
            summaryBox.innerHTML = `
                <div style="background:#f1f5f9; padding:10px; border-radius:6px; text-align:center;">
                    <div style="font-weight:600; color:#1e293b; font-size:12px;">Coincidencias SKU</div>
                    <div style="font-size:1.5rem; font-weight:700; color:#0284c7;">${stats.perfectMatches}</div>
                </div>
                <div style="background:#f1f5f9; padding:10px; border-radius:6px; text-align:center;">
                    <div style="font-weight:600; color:#1e293b; font-size:12px;">Unificados por Nombre</div>
                    <div style="font-size:1.5rem; font-weight:700; color:#16a34a;">${stats.updatedNames}</div>
                </div>
                <div style="background:#f1f5f9; padding:10px; border-radius:6px; text-align:center;">
                    <div style="font-weight:600; color:#1e293b; font-size:12px;">Sin Coincidencia</div>
                    <div style="font-size:1.5rem; font-weight:700; color:#ef4444;">${stats.unmatched}</div>
                </div>
            `;
            
            let logsHtml = '';
            if (stats.usedMock) {
                logsHtml += `<div style="color:#d97706; margin-bottom:8px; font-weight:600;"><i class="fa-solid fa-triangle-exclamation"></i> Usando datos de simulación fallback.</div>`;
            }
            
            stats.details.forEach(item => {
                let badge = '';
                let detailsStr = '';
                
                if (item.status === 'perfect') {
                    badge = `<span style="color:#0284c7; font-weight:bold;">[SKU MATCH]</span>`;
                    detailsStr = `Publicación: "${item.title}" coincide con producto local: "${item.localName}" (SKU: ${item.sku})`;
                } else if (item.status === 'updated') {
                    badge = `<span style="color:#16a34a; font-weight:bold;">[UNIFICADO]</span>`;
                    detailsStr = `Publicación "${item.title}" coincide por nombre. Se actualizó código local de ${item.localOldCode} a SKU: ${item.sku} para el producto "${item.localName}"`;
                } else if (item.status === 'unmatched') {
                    badge = `<span style="color:#ef4444; font-weight:bold;">[SIN MATCH]</span>`;
                    detailsStr = `Sin coincidencia por nombre o SKU para la publicación: "${item.title}" (SKU: ${item.sku})`;
                } else if (item.status === 'error') {
                    badge = `<span style="color:#b91c1c; font-weight:bold;">[ERROR]</span>`;
                    detailsStr = `Fallo al unificar publicación "${item.title}": ${item.error}`;
                }
                
                logsHtml += `<div style="margin-bottom:4px; padding-bottom:4px; border-bottom: 1px solid #f1f5f9;">${badge} ${detailsStr}</div>`;
            });
            
            logBox.innerHTML = logsHtml || 'No hay publicaciones analizadas.';
            
            loadInventario();
        } else {
            summaryBox.innerHTML = `<span style="color:#ef4444; font-weight:bold;">Error en unificación: ${res.error || 'Respuesta inválida'}</span>`;
        }
    } catch (err) {
        summaryBox.innerHTML = `<span style="color:#ef4444; font-weight:bold;">Error de red: ${err.message}</span>`;
    }
}

async function syncMercadoLibreStatus() {
    const btn = document.getElementById('btn-ml-sync-kardex');
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Sincronizando...';

    try {
        const res = await fetchApi(`/${activeTenant}/mercadolibre/sync`, {
            method: 'POST',
            body: { usuario: currentUserId }
        });

        alert(`Sincronización completada. Se procesaron ${res.details ? res.details.syncedCount : 0} publicaciones.`);
        
        // Reload current inventory page
        loadInventario(currentInventarioPage, inventarioSearchQuery);
    } catch (e) {
        alert('Error al sincronizar con Mercado Libre: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function triggerBackgroundMlSync() {
    if (window.mlSyncing) return;
    window.mlSyncing = true;
    localStorage.setItem('simplix_last_ml_sync', Date.now().toString());

    const btn = document.getElementById('btn-ml-sync-kardex');
    let originalText = '';
    if (btn) {
        originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Sincronizando...';
    }

    try {
        const res = await fetchApi(`/${activeTenant}/mercadolibre/sync`, {
            method: 'POST',
            body: { usuario: 'system_auto' }
        });
        console.log(`[AutoSync] Sincronización automática de Mercado Libre completada. Se procesaron ${res.details ? res.details.syncedCount : 0} publicaciones.`);
        
        // Reload current page if we are still on the inventory view
        if (activeView === 'inventario' && activeTenant === 'importadora') {
            loadInventario(currentInventarioPage, inventarioSearchQuery);
        }
    } catch (e) {
        console.error('[AutoSync] Error al sincronizar automáticamente con Mercado Libre:', e.message);
    } finally {
        window.mlSyncing = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

async function auditMercadoLibreSmoListings() {
    const btn = document.getElementById('btn-ml-audit-smo');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Auditando...';
    
    try {
        const res = await fetchApi(`/${activeTenant}/mercadolibre/audit-smo`, {
            method: 'POST',
            body: { usuario: currentUserId }
        });
        
        if (res.success) {
            // Set statistics
            document.getElementById('audit-stat-accounts').innerText = res.auditedAccounts.length;
            document.getElementById('audit-stat-scanned').innerText = res.summary.totalScanned;
            document.getElementById('audit-stat-deleted').innerText = res.summary.totalDeleted;
            
            // Show warning if mock fallback was used
            const warningAlert = document.getElementById('audit-mock-warning');
            if (res.summary.usedMock) {
                warningAlert.style.display = 'block';
            } else {
                warningAlert.style.display = 'none';
            }
            
            // Render deleted items
            const tableBody = document.getElementById('audit-report-table-body');
            tableBody.innerHTML = '';
            
            if (res.deletedItems && res.deletedItems.length > 0) {
                res.deletedItems.forEach(item => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td style="padding: 8px 10px; font-weight: 600;">${item.id}</td>
                        <td style="padding: 8px 10px;">${item.title}</td>
                        <td style="padding: 8px 10px; font-family: monospace; font-size: 11px;">${item.sku}</td>
                        <td style="padding: 8px 10px;">${item.account}</td>
                        <td style="padding: 8px 10px; text-align: center; color: #ef4444; font-weight: bold;"><i class="fa-solid fa-trash-can"></i> ELIMINADO</td>
                    `;
                    tableBody.appendChild(row);
                });
            } else {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="padding: 15px; text-align: center; color: var(--text-muted);">
                            <i class="fa-solid fa-circle-check" style="color: #16a34a; font-size: 16px; margin-right: 6px;"></i>
                            No se detectaron publicaciones con SKU SMO activas en Mercado Libre.
                        </td>
                    </tr>
                `;
            }
            
            // Open audit report modal
            showModal('ml-audit-report-modal');
        } else {
            alert('Error al realizar auditoría: ' + (res.error || 'Respuesta inválida'));
        }
    } catch (err) {
        alert('Falla al conectar con el servidor: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function showSimulateMLWebhookModal() {
    showModal('ml-webhook-modal');
}

async function submitSimulateMLWebhook(e) {
    e.preventDefault();
    
    const buyerName = document.getElementById('w-buyer-name').value.trim();
    const buyerNit = document.getElementById('w-buyer-nit').value.trim();
    const buyerEmail = document.getElementById('w-buyer-email').value.trim();
    const buyerPhone = document.getElementById('w-buyer-phone').value.trim();
    const itemTitle = document.getElementById('w-item-title').value.trim();
    const itemSku = document.getElementById('w-item-sku').value.trim();
    const itemQty = parseInt(document.getElementById('w-item-qty').value) || 1;
    const itemPrice = parseFloat(document.getElementById('w-item-price').value) || 0;
    const netReceived = parseFloat(document.getElementById('w-item-net-received').value) || 0;
    const accountName = document.getElementById('w-account-name').value;
    
    const payload = {
        is_mock: true,
        tenant_id: activeTenant,
        buyer_name: buyerName,
        buyer_nit: buyerNit || '222222222222',
        buyer_email: buyerEmail,
        buyer_phone: buyerPhone,
        item_title: itemTitle,
        item_sku: itemSku,
        item_quantity: itemQty,
        item_price: itemPrice,
        net_received: netReceived,
        account_name: accountName,
        user_id: 11111111,
        order_id: 'ML-' + Date.now()
    };
    
    try {
        const res = await fetchApi('/mercadolibre/webhook', {
            method: 'POST',
            body: payload
        });
        
        if (res.success) {
            alert(`¡Simulación exitosa!\n\nSe creó la factura contable: ${res.prefijo}-${res.numero}\nTotal causado: ${formatMoney(res.total)}\nTransmitido a la DIAN con éxito.`);
            closeModal('ml-webhook-modal');
            loadCurrentTenantData();
            loadMercadoLibreSales();
        } else {
            alert('Error al simular venta: ' + res.error);
        }
    } catch (err) {
        alert('Error de conexión con el simulador: ' + err.message);
    }
}

async function loadMercadoLibreSales() {
    const tbody = document.getElementById('ml-sales-history-tbody');
    if (!tbody) return;
    
    try {
        const sales = await fetchApi(`/${activeTenant}/mercadolibre/sales`);
        
        if (sales && sales.length > 0) {
            let html = '';
            sales.forEach(sale => {
                // Construct products string
                const productsHtml = sale.items.map(item => {
                    return `<div style="margin-bottom: 2px;">
                        <span class="badge badge-secondary" style="font-size: 10px;">${item.sku || 'N/A'}</span> 
                        ${item.producto_nombre || 'Producto sin nombre'} 
                        <strong style="color:var(--text-muted);">x${item.cantidad}</strong> 
                        <span style="color:var(--text-muted); font-size:11px;">(${formatMoney(item.precio_unitario)})</span>
                    </div>`;
                }).join('');
                
                let statusBadge = '';
                if (sale.dian_estado === 'ENVIADO') {
                    statusBadge = `<span class="badge badge-success" style="font-size: 10px; background-color: #22c55e;"><i class="fa-solid fa-circle-check"></i> Enviado</span>`;
                } else if (sale.dian_estado === 'PENDIENTE') {
                    statusBadge = `<span class="badge badge-warning" style="font-size: 10px; background-color: #eab308; color: #ffffff;"><i class="fa-solid fa-clock"></i> Pendiente</span>`;
                } else if (sale.dian_estado === 'RECHAZADO') {
                    statusBadge = `<span class="badge badge-danger" style="font-size: 10px; background-color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Rechazado</span>`;
                } else {
                    statusBadge = `<span class="badge badge-secondary" style="font-size: 10px;">${sale.dian_estado || 'N/A'}</span>`;
                }
                
                html += `
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td><a href="#" onclick="viewAsientoDetails(${sale.asiento_id}); return false;" style="font-weight: 600; color: var(--primary); text-decoration: underline;">${sale.prefijo}-${sale.numero}</a></td>
                        <td>${sale.fecha}</td>
                        <td>
                            <div style="font-weight: 500;">${sale.cliente_nombre}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">${sale.cliente_nit}</div>
                        </td>
                        <td>${productsHtml}</td>
                        <td style="text-align: right; font-weight: 600; color: #1e293b;">${formatMoney(sale.valor_publicado)}</td>
                        <td style="text-align: right; color: #ef4444; font-weight: 500;">-${formatMoney(sale.comision)}</td>
                        <td style="text-align: right; font-weight: 700; color: #16a34a;">${formatMoney(sale.valor_recibido)}</td>
                        <td style="text-align: center;">${statusBadge}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">
                        No se han registrado ventas automatizadas de Mercado Libre para este tenant.
                    </td>
                </tr>
            `;
        }
    } catch (err) {
        console.error('Error loading ML sales history:', err);
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: #ef4444; padding: 20px;">
                    <i class="fa-solid fa-triangle-exclamation"></i> Error al cargar el historial de ventas: ${err.message}
                </td>
            </tr>
        `;
    }
}

// ==========================================================================
// SECCIÓN: CONSOLA DE PREGUNTAS Y NOTIFICACIONES DE MERCADO LIBRE
// ==========================================================================
let mlQuestionsInterval = null;
const mlNotifiedQuestions = new Set();
let isFirstMLCheck = true;

function startMercadoLibreQuestionsPolling() {
    if (mlQuestionsInterval) clearInterval(mlQuestionsInterval);
    
    // Check immediately
    checkMercadoLibreQuestions();
    
    // Poll every 5 seconds
    mlQuestionsInterval = setInterval(checkMercadoLibreQuestions, 5000);
}

async function checkMercadoLibreQuestions() {
    // Only check for the 'importadora' tenant
    if (activeTenant !== 'importadora') {
        const badge = document.getElementById('ml-badge-counter');
        if (badge) badge.style.display = 'none';
        return;
    }
    
    try {
        const questions = await fetchApi(`/${activeTenant}/mercadolibre/questions?status=unanswered`);
        
        // Update sidebar badge
        const badge = document.getElementById('ml-badge-counter');
        if (badge) {
            badge.innerText = questions.length;
            if (questions.length > 0) {
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
        
        // If it's the first check, we just populate seen list to prevent retro-toast spamming
        if (isFirstMLCheck) {
            questions.forEach(q => mlNotifiedQuestions.add(q.id));
            isFirstMLCheck = false;
            return;
        }
        
        // Check for new questions
        questions.forEach(q => {
            if (!mlNotifiedQuestions.has(q.id)) {
                mlNotifiedQuestions.add(q.id);
                showMLQuestionToast(q);
            }
        });
        
        // If the user is currently viewing the questions, reload them dynamically
        if (activeView === 'mercadolibre') {
            const activeTab = document.querySelector('.view-panel#view-mercadolibre .tab-btn.active');
            if (activeTab && activeTab.getAttribute('data-tab') === 'tab-ml-preguntas') {
                renderMLQuestionsList(questions, 'unanswered', true);
            }
        }
    } catch (err) {
        console.error('Error polling Mercado Libre questions:', err);
    }
}

function showMLQuestionToast(q) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-card';
    toast.setAttribute('data-id', q.id);
    
    const accountClass = q.account_name === 'kyh' ? 'kyh' : 'patucarro';
    const accountLabel = q.account_name === 'kyh' ? 'KYH' : 'PATUCARRO';
    
    toast.innerHTML = `
        <div class="toast-icon ${accountClass}">
            <i class="fa-solid fa-question"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">
                <span>Nueva Pregunta ML</span>
                <span class="toast-time">Ahora</span>
            </div>
            <div class="toast-body">
                Llegó una pregunta por la cuenta <strong>${accountLabel}</strong>.<br>
                <strong>Cliente:</strong> @${q.buyer_nickname}<br>
                <strong>Pregunta:</strong> "${q.question_text}"
            </div>
            <div class="toast-footer">
                <i class="fa-solid fa-reply"></i> Clic para responder
            </div>
        </div>
        <button class="toast-close" onclick="event.stopPropagation(); this.parentElement.remove();">&times;</button>
    `;
    
    // Clicking the toast redirects and highlights the question
    toast.addEventListener('click', () => {
        changeView('mercadolibre');
        // Activate "Preguntas por responder" tab
        const tabBtn = document.querySelector('.view-panel#view-mercadolibre .tab-btn[data-tab="tab-ml-preguntas"]');
        if (tabBtn) tabBtn.click();
        
        // Highlight and focus the question after rendering
        setTimeout(() => {
            highlightAndFocusQuestion(q.id);
        }, 150);
        
        toast.remove();
    });
    
    container.appendChild(toast);
    
    // Trigger CSS slide-in animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Auto-remove after 10 seconds if not clicked
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }
    }, 10000);
}

function highlightAndFocusQuestion(qId) {
    const card = document.getElementById(`ml-question-card-${qId}`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlighted');
        
        const textarea = card.querySelector('.ml-answer-input');
        if (textarea) textarea.focus();
        
        setTimeout(() => {
            card.classList.remove('highlighted');
        }, 3000);
    }
}

async function loadMercadoLibreConsoleView() {
    // Activate default tab if none is active
    const activeTab = document.querySelector('.view-panel#view-mercadolibre .tab-btn.active');
    const tabName = activeTab ? activeTab.getAttribute('data-tab') : 'tab-ml-preguntas';
    
    if (tabName === 'tab-ml-preguntas') {
        await loadMercadoLibreQuestions('unanswered');
    } else if (tabName === 'tab-ml-preguntas-historial') {
        await loadMercadoLibreQuestions('answered');
    } else if (tabName === 'tab-ml-ventas') {
        await loadMercadoLibreSales();
    } else if (tabName === 'tab-ml-cuentas') {
        await loadMercadoLibreAccountsSettings();
    }
}

async function loadMercadoLibreAccountsSettings() {
    try {
        const accounts = await fetchApi(`/${activeTenant}/mercadolibre/accounts`);
        
        // Reset inputs and status badges
        document.getElementById('ml-client-id-1').value = '';
        document.getElementById('ml-client-secret-1').value = '';
        document.getElementById('ml-status-1').innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #94a3b8;"></i> Desconectada';
        
        document.getElementById('ml-client-id-2').value = '';
        document.getElementById('ml-client-secret-2').value = '';
        document.getElementById('ml-status-2').innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #94a3b8;"></i> Desconectada';
        
        accounts.forEach(acc => {
            if (acc.account_name === 'Cuenta 1') {
                document.getElementById('ml-client-id-1').value = acc.client_id || '';
                if (acc.active) {
                    document.getElementById('ml-status-1').innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #22c55e;"></i> Vinculada (Vendedor: ' + (acc.seller_id || 'Activo') + ')';
                }
            } else if (acc.account_name === 'Cuenta 2') {
                document.getElementById('ml-client-id-2').value = acc.client_id || '';
                if (acc.active) {
                    document.getElementById('ml-status-2').innerHTML = '<i class="fa-solid fa-circle-dot" style="color: #22c55e;"></i> Vinculada (Vendedor: ' + (acc.seller_id || 'Activo') + ')';
                }
            }
        });
    } catch (err) {
        console.error('Error loading Mercado Libre accounts settings:', err);
    }
}

function setupMercadoLibreConsoleTabs() {
    const tabBtns = document.querySelectorAll('.view-panel#view-mercadolibre .tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            if (tabName === 'tab-ml-preguntas') {
                loadMercadoLibreQuestions('unanswered');
            } else if (tabName === 'tab-ml-preguntas-historial') {
                loadMercadoLibreQuestions('answered');
            } else if (tabName === 'tab-ml-ventas') {
                loadMercadoLibreSales();
            } else if (tabName === 'tab-ml-cuentas') {
                loadMercadoLibreAccountsSettings();
            }
        });
    });
}

// ==========================================================================
// SECCIÓN: CONSOLA DE NUEVAS VENTAS DE MERCADO LIBRE
// ==========================================================================
let mlSalesInterval = null;
const mlNotifiedSales = new Set();
let isFirstMLSalesCheck = true;

function startMercadoLibreSalesPolling() {
    if (mlSalesInterval) clearInterval(mlSalesInterval);
    checkMercadoLibreSales();
    mlSalesInterval = setInterval(checkMercadoLibreSales, 5000);
}

async function checkMercadoLibreSales() {
    if (activeTenant !== 'importadora') {
        const badge = document.getElementById('ml-sales-badge-counter');
        if (badge) badge.style.display = 'none';
        return;
    }
    
    try {
        const sales = await fetchApi(`/${activeTenant}/mercadolibre/sales`);
        
        // Update sidebar badge
        const badge = document.getElementById('ml-sales-badge-counter');
        const unreadSales = sales.filter(s => s.ml_read === 0);
        if (badge) {
            badge.innerText = unreadSales.length;
            if (unreadSales.length > 0) {
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
        
        if (isFirstMLSalesCheck) {
            sales.forEach(s => mlNotifiedSales.add(s.asiento_id));
            isFirstMLSalesCheck = false;
            return;
        }
        
        sales.forEach(s => {
            if (!mlNotifiedSales.has(s.asiento_id)) {
                mlNotifiedSales.add(s.asiento_id);
                if (s.ml_read === 0) {
                    showMLSaleToast(s);
                }
            }
        });
        
        if (activeView === 'mercadolibre-ventas') {
            renderMLSalesTables(sales);
        }
    } catch (err) {
        console.error('Error polling Mercado Libre sales:', err);
    }
}

function showMLSaleToast(sale) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-card';
    toast.setAttribute('data-id', sale.asiento_id);
    
    const accountClass = sale.account_name === 'kyh' ? 'kyh' : 'patucarro';
    const accountLabel = sale.account_name === 'kyh' ? 'KYH' : 'PATUCARRO';
    const itemsSummary = sale.items.map(item => `${item.producto_nombre || 'Producto'} x${item.cantidad}`).join(', ');

    toast.innerHTML = `
        <div class="toast-icon ${accountClass}">
            <i class="fa-solid fa-cart-shopping"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">
                <span>Nueva Venta ML</span>
                <span class="toast-time">Ahora</span>
            </div>
            <div class="toast-body">
                Llegó una venta por la cuenta <strong>${accountLabel}</strong>.<br>
                <strong>Cliente:</strong> ${sale.cliente_nombre || 'Cliente ML'}<br>
                <strong>Productos:</strong> ${itemsSummary || 'Sin productos'}<br>
                <strong>Valor Neto:</strong> ${formatMoney(sale.valor_recibido)}
            </div>
            <div class="toast-footer">
                <i class="fa-solid fa-eye"></i> Clic para ver detalles
            </div>
        </div>
        <button class="toast-close" onclick="event.stopPropagation(); this.parentElement.remove();">&times;</button>
    `;
    
    toast.addEventListener('click', () => {
        changeView('mercadolibre-ventas');
        const tabId = sale.account_name === 'kyh' ? 'tab-sales-kyh' : 'tab-sales-patucarro';
        const tabBtn = document.querySelector(`.view-panel#view-mercadolibre-ventas .tab-btn[data-tab="${tabId}"]`);
        if (tabBtn) tabBtn.click();
        
        setTimeout(() => {
            highlightAndFocusSaleRow(sale.asiento_id);
        }, 150);
        
        toast.remove();
    });
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }
    }, 10000);
}

function highlightAndFocusSaleRow(asientoId) {
    const row = document.getElementById(`ml-sale-row-${asientoId}`);
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('highlighted');
        setTimeout(() => {
            row.classList.remove('highlighted');
        }, 3000);
    }
}

async function loadMercadoLibreSalesView() {
    try {
        const sales = await fetchApi(`/${activeTenant}/mercadolibre/sales`);
        renderMLSalesTables(sales);
        
        // Mark all as read
        await fetchApi(`/${activeTenant}/mercadolibre/mark-sales-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        
        const badge = document.getElementById('ml-sales-badge-counter');
        if (badge) badge.style.display = 'none';
        
        sales.forEach(s => {
            s.ml_read = 1;
        });
    } catch (err) {
        console.error('Error loading Mercado Libre sales view:', err);
    }
}

function renderMLSalesTables(sales) {
    const patucarroTbody = document.getElementById('ml-sales-patucarro-tbody');
    const kyhTbody = document.getElementById('ml-sales-kyh-tbody');
    
    if (!patucarroTbody || !kyhTbody) return;
    
    const patucarroSales = sales.filter(s => s.account_name === 'patucarro');
    const kyhSales = sales.filter(s => s.account_name === 'kyh');
    
    renderSingleSalesTable(patucarroSales, patucarroTbody, 'No se han registrado ventas automatizadas para patucarro.');
    renderSingleSalesTable(kyhSales, kyhTbody, 'No se han registrado ventas automatizadas para kyh.');
}

function renderSingleSalesTable(salesList, tbody, emptyMessage) {
    if (salesList && salesList.length > 0) {
        let html = '';
        salesList.forEach(sale => {
            const productsHtml = sale.items.map(item => {
                return `<div style="margin-bottom: 2px;">
                    <span class="badge badge-secondary" style="font-size: 10px;">${item.sku || 'N/A'}</span> 
                    ${item.producto_nombre || 'Producto sin nombre'} 
                    <strong style="color:var(--text-muted);">x${item.cantidad}</strong> 
                    <span style="color:var(--text-muted); font-size:11px;">(${formatMoney(item.precio_unitario)})</span>
                </div>`;
            }).join('');
            
            let statusBadge = '';
            if (sale.dian_estado === 'ENVIADO') {
                statusBadge = `<span class="badge badge-success" style="font-size: 10px; background-color: #22c55e;"><i class="fa-solid fa-circle-check"></i> Enviado</span>`;
            } else if (sale.dian_estado === 'PENDIENTE') {
                statusBadge = `<span class="badge badge-warning" style="font-size: 10px; background-color: #eab308; color: #ffffff;"><i class="fa-solid fa-clock"></i> Pendiente</span>`;
            } else if (sale.dian_estado === 'RECHAZADO') {
                statusBadge = `<span class="badge badge-danger" style="font-size: 10px; background-color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Rechazado</span>`;
            } else {
                statusBadge = `<span class="badge badge-secondary" style="font-size: 10px;">${sale.dian_estado || 'N/A'}</span>`;
            }
            
            html += `
                <tr id="ml-sale-row-${sale.asiento_id}" style="border-bottom: 1px solid var(--border); transition: background-color 0.5s ease;">
                    <td><a href="#" onclick="viewAsientoDetails(${sale.asiento_id}); return false;" style="font-weight: 600; color: var(--primary); text-decoration: underline;">${sale.prefijo}-${sale.numero}</a></td>
                    <td>${sale.fecha}</td>
                    <td>
                        <div style="font-weight: 500;">${sale.cliente_nombre}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${sale.cliente_nit}</div>
                    </td>
                    <td>${productsHtml}</td>
                    <td style="text-align: right; font-weight: 600; color: #1e293b;">${formatMoney(sale.valor_publicado)}</td>
                    <td style="text-align: right; color: #ef4444; font-weight: 500;">-${formatMoney(sale.comision)}</td>
                    <td style="text-align: right; font-weight: 700; color: #16a34a;">${formatMoney(sale.valor_recibido)}</td>
                    <td style="text-align: center;">${statusBadge}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } else {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">
                    ${emptyMessage}
                </td>
            </tr>
        `;
    }
}

function setupMercadoLibreSalesTabs() {
    const tabBtns = document.querySelectorAll('.view-panel#view-mercadolibre-ventas .tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // We can reload if needed
        });
    });
}

async function loadMercadoLibreQuestions(status = 'unanswered') {
    const containerId = status === 'unanswered' ? 'ml-pending-questions-container' : 'ml-answered-questions-container';
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Spinner
    container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 30px;">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; margin-bottom: 10px;"></i>
            <p>Cargando preguntas...</p>
        </div>
    `;
    
    try {
        const questions = await fetchApi(`/${activeTenant}/mercadolibre/questions?status=${status}`);
        renderMLQuestionsList(questions, status, false);
    } catch (err) {
        container.innerHTML = `
            <div style="text-align: center; color: #ef4444; padding: 30px;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>Error al cargar preguntas: ${err.message}</p>
            </div>
        `;
    }
}

function renderMLQuestionsList(questions, status, isSilent = false) {
    const containerId = status === 'unanswered' ? 'ml-pending-questions-container' : 'ml-answered-questions-container';
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (isSilent) {
        const activeElement = document.activeElement;
        if (activeElement && activeElement.classList.contains('ml-answer-input')) {
            // User is typing, skip auto-update
            return;
        }
    }
    
    if (!questions || questions.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 30px; border: 1px dashed var(--border); border-radius: 8px;">
                <p>${status === 'unanswered' ? 'No hay preguntas pendientes por responder.' : 'No hay historial de preguntas respondidas.'}</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    questions.forEach(q => {
        const accountClass = q.account_name === 'kyh' ? 'kyh' : 'patucarro';
        const accountLabel = q.account_name === 'kyh' ? 'KYH' : 'PATUCARRO';
        const dateStr = new Date(q.date_created).toLocaleString();
        
        let actionArea = '';
        if (status === 'unanswered') {
            actionArea = `
                <div class="ml-answer-area">
                    <textarea class="ml-answer-input" placeholder="Escribe tu respuesta aquí..." rows="2" id="ml-reply-input-${q.id}"></textarea>
                    <div class="ml-answer-actions">
                        <button class="btn btn-primary btn-sm" onclick="submitMLAnswer('${q.id}')">
                            <i class="fa-solid fa-paper-plane"></i> Responder
                        </button>
                    </div>
                </div>
            `;
        } else {
            actionArea = `
                <div class="ml-answered-bubble">
                    <div class="ml-answered-title"><i class="fa-solid fa-reply"></i> Respondido</div>
                    <div class="ml-answered-text">${q.answer_text || ''}</div>
                </div>
            `;
        }
        
        html += `
            <div class="ml-question-card" id="ml-question-card-${q.id}">
                <div class="ml-question-header">
                    <div>
                        <span class="ml-account-tag ${accountClass}">
                            <i class="fa-solid fa-circle-dot"></i> ${accountLabel}
                        </span>
                        <span style="font-weight: 700; font-size: 13px; margin-left: 8px;">@${q.buyer_nickname}</span>
                    </div>
                    <span class="ml-item-link" title="${q.item_title}">${q.item_title}</span>
                </div>
                <div class="ml-question-body">
                    <div class="ml-question-text">"${q.question_text}"</div>
                    <div class="ml-question-meta"><i class="fa-solid fa-clock"></i> ${dateStr}</div>
                </div>
                ${actionArea}
            </div>
        `;
    });
    
    container.innerHTML = html;
}

async function submitMLAnswer(qId) {
    const input = document.getElementById(`ml-reply-input-${qId}`);
    if (!input) return;
    
    const answerText = input.value.trim();
    if (!answerText) {
        alert('Por favor, escribe una respuesta.');
        return;
    }
    
    const btn = input.nextElementSibling.querySelector('button');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando...';
    
    try {
        const res = await fetchApi(`/${activeTenant}/mercadolibre/answer-question`, {
            method: 'POST',
            body: {
                questionId: qId,
                answerText: answerText,
                usuario: currentUserId || 'admin'
            }
        });
        
        if (res.success) {
            mlNotifiedQuestions.delete(qId);
            alert('Respuesta enviada y guardada con éxito.');
            checkMercadoLibreQuestions();
            loadMercadoLibreQuestions('unanswered');
        } else {
            alert('Error al enviar respuesta: ' + res.error);
        }
    } catch (err) {
        alert('Error de conexión con el servidor: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function submitSimulateMLQuestionWebhook(e) {
    e.preventDefault();
    
    const accountName = document.getElementById('w-q-account-name').value;
    const buyerNickname = document.getElementById('w-q-buyer').value.trim();
    const itemSelect = document.getElementById('w-q-item');
    const itemId = itemSelect.value;
    const itemTitle = itemSelect.options[itemSelect.selectedIndex].getAttribute('data-title');
    const questionText = document.getElementById('w-q-text').value.trim();
    
    const payload = {
        is_question: true,
        is_mock: true,
        question_id: 'q_mock_' + Date.now(),
        tenant_id: activeTenant,
        account_name: accountName,
        seller_id: accountName === 'patucarro' ? '123456' : '789012',
        item_id: itemId,
        item_title: itemTitle,
        question_text: questionText,
        buyer_nickname: buyerNickname
    };
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Disparando...';
    
    try {
        const res = await fetchApi('/mercadolibre/webhook', {
            method: 'POST',
            body: payload
        });
        
        if (res.success) {
            closeModal('ml-webhook-modal');
            await checkMercadoLibreQuestions();
        } else {
            alert('Error al simular pregunta: ' + res.error);
        }
    } catch (err) {
        alert('Error de conexión: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function switchModalTab(tabId) {
    const modal = document.getElementById('ml-webhook-modal');
    if (!modal) return;
    
    modal.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    modal.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === tabId) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}


