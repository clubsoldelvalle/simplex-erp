<?php
header('Content-Type: text/plain; charset=utf-8');
$dir = '/home/u727870701/domains/repuestoscajica.com/public_html/upsseler/consolo/data';
if (is_dir($dir)) {
    $files = scandir($dir);
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        echo "$f: " . filesize($dir . '/' . $f) . " bytes\n";
    }
} else {
    echo "Directory $dir not found.\n";
}
?>
