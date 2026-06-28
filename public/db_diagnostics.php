<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

header('Content-Type: text/plain; charset=utf-8');

$dbPath = __DIR__ . '/../data/tenant_importadora.db';
echo "Database Path: " . realpath($dbPath) . "\n";
if (!file_exists($dbPath)) {
    die("ERROR: Database file does not exist.\n");
}
echo "Database Size: " . filesize($dbPath) . " bytes\n";

try {
    $db = new SQLite3($dbPath);
    echo "Successfully connected to SQLite database.\n";
    
    // Count total terceros
    $total = $db->querySingle("SELECT COUNT(*) FROM terceros");
    echo "Total rows in terceros: " . $total . "\n";
    
    // Search for Karolain
    echo "\nSearching for 'karol' in terceros table:\n";
    $stmt = $db->prepare("SELECT id, identificacion, nombre, apellidos, tipo_empleado FROM terceros WHERE nombre LIKE :query OR apellidos LIKE :query");
    $query = '%karol%';
    $stmt->bindValue(':query', $query, SQLITE3_TEXT);
    $result = $stmt->execute();
    
    $found = 0;
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $found++;
        echo " - ID: {$row['id']}, NIT: {$row['identificacion']}, Nombre: {$row['nombre']} {$row['apellidos']}, Tipo Emp: {$row['tipo_empleado']}\n";
    }
    
    if ($found === 0) {
        echo " No matching terceros found for '%karol%'.\n";
    }
    
    // Let's print first 5 rows in terceros
    echo "\nFirst 5 rows in terceros:\n";
    $result = $db->query("SELECT id, identificacion, nombre, apellidos FROM terceros LIMIT 5");
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        echo " - ID: {$row['id']}, NIT: {$row['identificacion']}, Nombre: {$row['nombre']} {$row['apellidos']}\n";
    }
    
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
?>
