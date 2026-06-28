<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

$dbPath = __DIR__ . '/../data/tenant_importadora.db';
if (!file_exists($dbPath)) {
    die("Database not found at $dbPath");
}

try {
    $db = new SQLite3($dbPath);
    echo "Connected to database.<br>";
    
    // Check if ml_read exists
    $result = @$db->query("SELECT ml_read FROM asientos LIMIT 1");
    if ($result) {
        echo "Column ml_read already exists.<br>";
    } else {
        echo "Column ml_read does not exist. Running migration...<br>";
        $ok = $db->exec("ALTER TABLE asientos ADD COLUMN ml_read INTEGER DEFAULT 0");
        if ($ok) {
            echo "Migration successful!<br>";
        } else {
            echo "Migration failed.<br>";
        }
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "<br>";
}
?>
