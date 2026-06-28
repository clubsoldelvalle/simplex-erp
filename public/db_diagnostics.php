<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

header('Content-Type: text/plain; charset=utf-8');

echo "Scanning for database files...\n";

function find_dbs($dir) {
    if (!is_dir($dir)) return;
    $files = @scandir($dir);
    if (!$files) return;
    
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $full = $dir . '/' . $f;
        if (is_dir($full)) {
            // Avoid recursive loops or huge folders
            if (strpos($full, 'node_modules') === false && strpos($full, '.git') === false) {
                find_dbs($full);
            }
        } else {
            if (substr($f, -3) === '.db') {
                echo "- $full: " . filesize($full) . " bytes\n";
                if (filesize($full) > 1000) {
                    try {
                        $db = new SQLite3($full);
                        $tables = [];
                        $res = $db->query("SELECT name FROM sqlite_master WHERE type='table'");
                        while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
                            $tables[] = $row['name'];
                        }
                        echo "  Tables: " . implode(', ', $tables) . "\n";
                        
                        if (in_array('terceros', $tables)) {
                            $total = $db->querySingle("SELECT COUNT(*) FROM terceros");
                            echo "  Total terceros: $total\n";
                            
                            $found = $db->querySingle("SELECT COUNT(*) FROM terceros WHERE nombre LIKE '%karol%'");
                            echo "  Terceros with 'karol': $found\n";
                        }
                    } catch (Exception $e) {
                        echo "  DB Error: " . $e->getMessage() . "\n";
                    }
                }
            }
        }
    }
}

find_dbs('/home/u727870701/domains/simplix.repuestoscajica.com');
?>
