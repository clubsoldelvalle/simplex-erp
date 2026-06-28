<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

header('Content-Type: text/plain; charset=utf-8');

echo "=== Hostinger Node.js Folder Diagnostics ===\n";

$dir = '/home/u727870701/domains/simplix.repuestoscajica.com/nodejs';
if (is_dir($dir)) {
    echo "Directory exists: $dir\n\n";
    $files = scandir($dir);
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $path = $dir . '/' . $f;
        $type = is_dir($path) ? 'DIR' : 'FILE';
        $size = ($type === 'FILE') ? @filesize($path) . ' bytes' : '';
        echo " - [$type] $f $size\n";
        
        // If it's a log file or text file, print its last 30 lines
        if ($type === 'FILE' && (strpos($f, 'log') !== false || strpos($f, 'txt') !== false || strpos($f, 'err') !== false)) {
            echo "   --- Content of $f (last 30 lines) ---\n";
            $lines = @file($path);
            if ($lines) {
                $last_lines = array_slice($lines, -30);
                foreach ($last_lines as $l) {
                    echo "     " . trim($l) . "\n";
                }
            } else {
                echo "     (Empty or unreadable)\n";
            }
            echo "   -------------------------------------\n\n";
        }
    }
} else {
    echo "Directory not found: $dir\n";
}
?>
