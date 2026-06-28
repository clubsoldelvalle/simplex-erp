<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

header('Content-Type: text/plain; charset=utf-8');

echo "=== DB Copy Utility with Error Handling ===\n";

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

$files = ['tenant_importadora.db', 'tenant_club.db', 'global.db'];
foreach ($files as $f) {
    $srcFile = $srcDir . '/' . $f;
    $destFile = $destDir . '/' . $f;
    
    echo "Copying $f:\n";
    if (file_exists($srcFile)) {
        echo "  Source size: " . filesize($srcFile) . " bytes\n";
        
        // Delete destination first to avoid lock issues if possible
        if (file_exists($destFile)) {
            echo "  Destination exists, trying to delete...\n";
            $del = @unlink($destFile);
            if ($del) {
                echo "  Successfully deleted old destination file.\n";
            } else {
                echo "  Failed to delete old destination file (might be locked by Node.js).\n";
            }
        }
        
        $ok = @copy($srcFile, $destFile);
        if ($ok) {
            echo "  SUCCESS! Destination size: " . filesize($destFile) . " bytes\n";
        } else {
            $err = error_get_last();
            echo "  FAILED to copy. Error: " . ($err ? $err['message'] : 'unknown') . "\n";
        }
    } else {
        echo "  Source file does not exist.\n";
    }
    echo "\n";
}
?>
