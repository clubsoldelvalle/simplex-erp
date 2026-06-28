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
    $real = realpath($p);
    echo "Path: $p\n";
    if ($real) {
        $size = filesize($real);
        echo "  Realpath: $real\n";
        echo "  Size: $size bytes\n";
        if ($size > 100) {
            try {
                $db = new SQLite3($real);
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
            } catch (Exception $e) {
                echo "  DB Error: " . $e->getMessage() . "\n";
            }
        } else {
            echo "  File is too small to be a database. Reading content:\n";
            echo "  [" . file_get_contents($real) . "]\n";
        }
    } else {
        echo "  Does not exist.\n";
    }
    echo "\n";
}
?>
