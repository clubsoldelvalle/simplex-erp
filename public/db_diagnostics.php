<?php
header('Content-Type: text/plain; charset=utf-8');
$dir = '/home/u727870701/domains/repuestoscajica.com/public_html/upsseler/consolo/data';
if (is_dir($dir)) {
    $files = scandir($dir);
    foreach ($files as $f) {
        if (strpos($f, 'tenant_') === 0) {
            $path = $dir . '/' . $f;
            $size = 'unknown';
            try {
                $size = @filesize($path);
                if ($size === false) {
                    $err = error_get_last();
                    $size = 'error (' . ($err ? $err['message'] : 'unknown') . ')';
                }
            } catch (Exception $e) {
                $size = 'exception: ' . $e->getMessage();
            }
            echo "$f: $size bytes\n";
        }
    }
} else {
    echo "Directory not found.\n";
}
?>
