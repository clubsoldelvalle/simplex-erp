<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

header('Content-Type: text/plain; charset=utf-8');

echo "Current Directory: " . __DIR__ . "\n";
echo "Doc Root: " . $_SERVER['DOCUMENT_ROOT'] . "\n\n";

$potentialPaths = [
    __DIR__ . '/../data/tenant_importadora.db',
    __DIR__ . '/../../data/tenant_importadora.db',
    '/home/u727870701/domains/repuestoscajica.com/public_html/upsseler/consolo/data/tenant_importadora.db',
    '/home/u727870701/domains/repuestoscajica.com/public_html/data/tenant_importadora.db',
    '/home/u727870701/domains/repuestoscajica.com/data/tenant_importadora.db',
];

foreach ($potentialPaths as $p) {
    echo "Checking: $p\n";
    if (file_exists($p)) {
        echo "--> EXISTS! Size: " . filesize($p) . " bytes\n";
        
        try {
            $db = new SQLite3($p);
            $total = $db->querySingle("SELECT COUNT(*) FROM terceros");
            echo "--> Connected! Total Terceros: " . $total . "\n";
            
            // Search Karolain
            $stmt = $db->prepare("SELECT id, identificacion, nombre, apellidos FROM terceros WHERE nombre LIKE '%karol%'");
            $res = $stmt->execute();
            while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
                echo "    Found: ID={$row['id']}, NIT={$row['identificacion']}, Nombre={$row['nombre']} {$row['apellidos']}\n";
            }
        } catch (Exception $e) {
            echo "    Error: " . $e->getMessage() . "\n";
        }
    } else {
        echo "--> Does not exist.\n";
    }
    echo "\n";
}

// Check contents of parent directories
echo "=== Parent directory listings ===\n";
$dir = __DIR__;
for ($i = 0; $i < 3; $i++) {
    $dir = dirname($dir);
    echo "\nDirectory: $dir\n";
    if (is_dir($dir)) {
        $files = scandir($dir);
        foreach ($files as $f) {
            if ($f === '.' || $f === '..') continue;
            $full = $dir . '/' . $f;
            $type = is_dir($full) ? 'DIR' : 'FILE';
            $size = $type === 'FILE' ? filesize($full) . ' B' : '';
            echo "  [$type] $f $size\n";
        }
    }
}
?>
