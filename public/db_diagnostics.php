<?php
header('Content-Type: text/plain; charset=utf-8');
$p = '/home/u727870701/domains/repuestoscajica.com/public_html/upsseler/consolo/data/tenant_importadora.db';
if (file_exists($p)) {
    echo "Content of $p:\n";
    echo file_get_contents($p);
} else {
    echo "$p does not exist.\n";
}
?>
