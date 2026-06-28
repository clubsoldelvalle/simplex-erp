<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

header('Content-Type: text/plain; charset=utf-8');

echo "=== Hostinger Database Diagnostics ===\n";

$paths_to_test = [
    '/home/u727870701/domains/repuestoscajica.com/public_html/upsseler/consolo/data/tenant_importadora.db',
    '/home/u727870701/domains/simplix.repuestoscajica.com/nodejs/data/tenant_importadora.db',
    '/home/u727870701/domains/simplix.repuestoscajica.com/data/tenant_importadora.db',
    __DIR__ . '/../data/tenant_importadora.db',
    __DIR__ . '/../../data/tenant_importadora.db'
];

foreach ($paths_to_test as $p) {
    echo "Path: $p\n";
    $real = realpath($p);
    if ($real === false) {
        echo "  Does not exist.\n\n";
        continue;
    }
    
    echo "  Realpath: $real\n";
    $size = filesize($real);
    echo "  Size: $size bytes\n";
    
    if ($size < 100) {
        echo "  File is too small to be a database.\n";
        try {
            $content = file_get_contents($real);
            echo "  Content: [" . $content . "]\n";
        } catch (Exception $e) {
            echo "  Read Error: " . $e->getMessage() . "\n";
        }
        echo "\n";
        continue;
    }
    
    try {
        $db = new SQLite3($real);
        echo "  Successfully connected to SQLite3.\n";
        
        $total = $db->querySingle("SELECT COUNT(*) FROM terceros");
        echo "  Total terceros: $total\n";
        
        $karolCount = $db->querySingle("SELECT COUNT(*) FROM terceros WHERE nombre LIKE '%karol%'");
        echo "  Terceros with 'karol': $karolCount\n";
        
        if ($karolCount > 0) {
            $res = $db->query("SELECT id, identificacion, nombre, apellidos FROM terceros WHERE nombre LIKE '%karol%'");
            while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
                echo "    - ID: {$row['id']}, NIT: {$row['identificacion']}, Nombre: {$row['nombre']} {$row['apellidos']}\n";
            }
        }
    } catch (Throwable $e) {
        echo "  Exception/Error: " . $e->getMessage() . "\n";
    }
    echo "\n";
}
?>
