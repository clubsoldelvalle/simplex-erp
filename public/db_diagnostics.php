<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

header('Content-Type: text/plain; charset=utf-8');

echo "=== DB Copy Utility ===\n";

$srcDir = '/home/u727870701/domains/repuestoscajica.com/public_html/upsseler/consolo/data';
$destDir = '/home/u727870701/domains/simplix.repuestoscajica.com/nodejs/data';

echo "Source Dir: $srcDir\n";
echo "Dest Dir: $destDir\n\n";

if (!is_dir($srcDir)) {
    die("ERROR: Source directory not found.\n");
}

if (!is_dir($destDir)) {
    echo "Creating destination directory...\n";
    mkdir($destDir, 0755, true);
}

$files = ['global.db', 'tenant_club.db', 'tenant_importadora.db'];
foreach ($files as $f) {
    $srcFile = $srcDir . '/' . $f;
    $destFile = $destDir . '/' . $f;
    
    echo "Copying $f:\n";
    if (file_exists($srcFile)) {
        echo "  Source size: " . filesize($srcFile) . " bytes\n";
        $ok = copy($srcFile, $destFile);
        if ($ok) {
            echo "  SUCCESS! Destination size: " . filesize($destFile) . " bytes\n";
        } else {
            echo "  FAILED to copy.\n";
        }
    } else {
        echo "  Source file does not exist.\n";
    }
    echo "\n";
}
?>
