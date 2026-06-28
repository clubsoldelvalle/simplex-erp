const { spawn } = require('child_process');
const { getTenantDb } = require('./db');
const path = require('path');
const fs = require('fs');

// Helper to run PowerShell command and return JSON parsed output
function runPowerShellQuery(dbName, sqlQuery) {
    return new Promise((resolve, reject) => {
        const tempScriptPath = path.join(__dirname, `temp_query_${Date.now()}.ps1`);
        
        // We use ADO.NET connection to query SQL Server and convert to JSON
        const psScript = `
            $connectionString = "Server=.\\WORLDOFFICE22;Database=${dbName};Integrated Security=True"
            $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
            try {
                $connection.Open()
                $command = $connection.CreateCommand()
                $command.CommandText = @"
${sqlQuery}
"@
                $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($command)
                $dataTable = New-Object System.Data.DataTable
                $adapter.Fill($dataTable) | Out-Null
                
                # Convert to custom objects to ensure clean serialization
                $rows = New-Object System.Collections.Generic.List[PSObject]
                foreach ($row in $dataTable.Rows) {
                    $obj = New-Object PSObject
                    foreach ($col in $dataTable.Columns) {
                        $val = $row[$col.ColumnName]
                        if ($val -eq [DBNull]::Value) { 
                            $val = $null 
                        } elseif ($val -is [string]) {
                            # Replace control characters with spaces to avoid JSON corruption
                            $val = $val -replace '[\\x00-\\x1F\\x7F]', ' '
                        }
                        $obj | Add-Member -MemberType NoteProperty -Name $col.ColumnName -Value $val
                    }
                    $rows.Add($obj)
                }
                
                $rows | ConvertTo-Json -Depth 5 -Compress
            } catch {
                Write-Error $_.Exception.Message
            } finally {
                $connection.Close()
            }
        `;

        try {
            fs.writeFileSync(tempScriptPath, psScript, { encoding: 'utf8' });
        } catch (err) {
            return reject(new Error(`Failed to write temp PowerShell script: ${err.message}`));
        }

        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', tempScriptPath
        ]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ps.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ps.on('close', (code) => {
            // Clean up temp file
            try {
                if (fs.existsSync(tempScriptPath)) {
                    fs.unlinkSync(tempScriptPath);
                }
            } catch (err) {
                console.error(`Failed to delete temp script file ${tempScriptPath}:`, err);
            }

            if (code !== 0) {
                return reject(new Error(`PowerShell exited with code ${code}. Stderr: ${stderr}`));
            }
            try {
                if (!stdout.trim()) {
                    return resolve([]);
                }
                resolve(JSON.parse(stdout));
            } catch (err) {
                reject(new Error(`Failed to parse JSON from PowerShell output: ${err.message}. Raw output: ${stdout.substring(0, 1000)}`));
            }
        });
    });
}

async function migrateImportadora() {
    console.log('Starting unified migration from SQL Server to tenant_importadora...');
    
    const db = getTenantDb('importadora');
    const dbName = 'nuevo patucarro';
    const tempScriptPath = path.join(__dirname, `temp_unified_migration_${Date.now()}.ps1`);
    const tempJsonPath = path.join(__dirname, `temp_output_${Date.now()}.json`);
    const formattedJsonPath = tempJsonPath.replace(/\\/g, '/');

    // Unified PowerShell script
    const psScript = `
        $connectionString = "Server=.\\WORLDOFFICE22;Database=${dbName};Integrated Security=True"
        $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
        try {
            $connection.Open()
            $cmd = $connection.CreateCommand()

            # 1. PUC Query
            $cmd.CommandText = "SELECT * FROM CuentasContables"
            $dtPuc = New-Object System.Data.DataTable
            (New-Object System.Data.SqlClient.SqlDataAdapter($cmd)).Fill($dtPuc) | Out-Null
            $colCodigo = $dtPuc.Columns[2].ColumnName
            
            $pucList = New-Object System.Collections.Generic.List[PSObject]
            foreach ($row in $dtPuc.Rows) {
                $obj = New-Object PSObject
                $obj | Add-Member -MemberType NoteProperty -Name 'IdCuentaContable' -Value $row['IdCuentaContable']
                $obj | Add-Member -MemberType NoteProperty -Name 'Codigo' -Value ( "$($row[$colCodigo])".Trim() )
                $obj | Add-Member -MemberType NoteProperty -Name 'Nombre' -Value ( "$($row['CuentaContable'])".Trim() )
                $obj | Add-Member -MemberType NoteProperty -Name 'SubCuentaContableDe' -Value $row['SubCuentaContableDe']
                $obj | Add-Member -MemberType NoteProperty -Name 'ManejoDeTercero' -Value $row['ManejoDeTercero']
                $obj | Add-Member -MemberType NoteProperty -Name 'Inactivo' -Value $row['Inactivo']
                $pucList.Add($obj)
            }

            # 2. Terceros Query
            $cmd.CommandText = "SELECT * FROM Vista_Auxiliar_Terceros"
            $dtTerc = New-Object System.Data.DataTable
            (New-Object System.Data.SqlClient.SqlDataAdapter($cmd)).Fill($dtTerc) | Out-Null
            $colTel = $dtTerc.Columns | Where-Object { $_.ColumnName -match 'fonos|fono' } | Select-Object -First 1 -ExpandProperty ColumnName
            
            $tercList = New-Object System.Collections.Generic.List[PSObject]
            foreach ($row in $dtTerc.Rows) {
                if ($row['Identificacion'] -eq [DBNull]::Value -or [string]::IsNullOrEmpty($row['Identificacion'])) { continue }
                $obj = New-Object PSObject
                $obj | Add-Member -MemberType NoteProperty -Name 'Tipo_Identificacion' -Value $row['Tipo_Identificacion']
                $obj | Add-Member -MemberType NoteProperty -Name 'Identificacion' -Value ( "$($row['Identificacion'])".Trim() )
                $obj | Add-Member -MemberType NoteProperty -Name 'DV' -Value $row['Digito_Verificacion']
                $obj | Add-Member -MemberType NoteProperty -Name 'Primer_Nombre' -Value $row['Primer_Nombre']
                $obj | Add-Member -MemberType NoteProperty -Name 'Segundo_Nombre' -Value $row['Segundo_Nombre']
                $obj | Add-Member -MemberType NoteProperty -Name 'Primer_Apellido' -Value $row['Primer_Apellido']
                $obj | Add-Member -MemberType NoteProperty -Name 'Segundo_Apellido' -Value $row['Segundo_Apellido']
                $obj | Add-Member -MemberType NoteProperty -Name 'Direccion' -Value $row['Direccion']
                $obj | Add-Member -MemberType NoteProperty -Name 'Ciudad' -Value $row['Ciudad_Direccion']
                $obj | Add-Member -MemberType NoteProperty -Name 'Telefono' -Value $row[$colTel]
                $obj | Add-Member -MemberType NoteProperty -Name 'EMail' -Value $row['EMail']
                $obj | Add-Member -MemberType NoteProperty -Name 'Aplica_ReteIca' -Value $row['Aplica_ReteIca']
                $obj | Add-Member -MemberType NoteProperty -Name 'Tarifa_ICA' -Value $row['Tarifa_ICA']
                $obj | Add-Member -MemberType NoteProperty -Name 'Activo' -Value $row['Activo']
                $tercList.Add($obj)
            }

            # 3. Inventario Query
            $cmd.CommandText = "SELECT * FROM Inventarios"
            $dtInv = New-Object System.Data.DataTable
            (New-Object System.Data.SqlClient.SqlDataAdapter($cmd)).Fill($dtInv) | Out-Null
            $colCodInv = $dtInv.Columns[1].ColumnName
            $colDesc = $dtInv.Columns[2].ColumnName
            $colMin = $dtInv.Columns[5].ColumnName
            
            $invList = New-Object System.Collections.Generic.List[PSObject]
            foreach ($row in $dtInv.Rows) {
                if ($row[$colCodInv] -eq [DBNull]::Value -or [string]::IsNullOrEmpty($row[$colCodInv])) { continue }
                $obj = New-Object PSObject
                $obj | Add-Member -MemberType NoteProperty -Name 'Codigo' -Value ( "$($row[$colCodInv])".Trim() )
                $obj | Add-Member -MemberType NoteProperty -Name 'Descripcion' -Value ( "$($row[$colDesc])".Trim() )
                $obj | Add-Member -MemberType NoteProperty -Name 'Precio' -Value $row['Precio1']
                $obj | Add-Member -MemberType NoteProperty -Name 'StockMinimo' -Value $row[$colMin]
                $obj | Add-Member -MemberType NoteProperty -Name 'Iva' -Value $row['Iva']
                $obj | Add-Member -MemberType NoteProperty -Name 'Activo' -Value $row['Activo']
                $obj | Add-Member -MemberType NoteProperty -Name 'Marca' -Value $row['Personalizado1']
                $obj | Add-Member -MemberType NoteProperty -Name 'Compatibilidad' -Value $row['Personalizado2']
                $invList.Add($obj)
            }

            $connection.Close()

            $cleanObj = @{
                puc = $pucList
                terceros = $tercList
                inventario = $invList
            }

            # Serialize and strip control characters
            $json = $cleanObj | ConvertTo-Json -Depth 5 -Compress
            $json = $json -replace '\\p{Cc}', ' '
            
            # Write directly to temporary file on disk using .NET UTF8 writer
            [System.IO.File]::WriteAllText("${formattedJsonPath}", $json, [System.Text.Encoding]::UTF8)

        } catch {
            if ($connection.State -eq "Open") { $connection.Close() }
            Write-Error $_.Exception.Message
            exit 1
        }
    `;

    // Write temp script
    fs.writeFileSync(tempScriptPath, psScript, { encoding: 'utf8' });

    // Spawn PowerShell
    const data = await new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', tempScriptPath
        ]);

        let stderr = '';

        ps.stderr.on('data', chunk => { stderr += chunk.toString(); });

        ps.on('close', code => {
            // Clean up temp script file
            try {
                if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
            } catch(e) {}

            if (code !== 0) {
                try {
                    if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
                } catch(e) {}
                return reject(new Error(`PowerShell returned code ${code}. Stderr: ${stderr}`));
            }

            // Read the data file
            try {
                if (!fs.existsSync(tempJsonPath)) {
                    return resolve({ puc: [], terceros: [], inventario: [] });
                }
                let content = fs.readFileSync(tempJsonPath, 'utf8');
                if (content.charCodeAt(0) === 0xFEFF) {
                    content = content.slice(1);
                }
                
                // Clean up temp JSON file
                fs.unlinkSync(tempJsonPath);
                
                if (!content.trim()) return resolve({ puc: [], terceros: [], inventario: [] });
                resolve(JSON.parse(content));
            } catch (err) {
                reject(new Error(`JSON parse error of file contents: ${err.message}`));
            }
        });
    });

    console.log(`Fetched data: PUC=${data.puc.length}, Terceros=${data.terceros.length}, Inventarios=${data.inventario.length}`);

    // --- SQLite Transactional Insertion ---
    
    // 1. Save PUC
    if (data.puc.length > 0) {
        db.exec("DELETE FROM puc;");
        const insertPuc = db.prepare(`
            INSERT OR IGNORE INTO puc (codigo, nombre, requiere_tercero, requiere_centro_costo, activo, parent_codigo)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        db.exec("BEGIN TRANSACTION;");
        try {
            const idToCodeMap = {};
            data.puc.forEach(acc => { idToCodeMap[acc.IdCuentaContable] = acc.Codigo; });

            for (const acc of data.puc) {
                const parentCode = acc.SubCuentaContableDe ? idToCodeMap[acc.SubCuentaContableDe] : null;
                const reqCc = (acc.Codigo.startsWith('41') || acc.Codigo.startsWith('51') || acc.Codigo.startsWith('52') || acc.Codigo.startsWith('61')) ? 1 : 0;
                
                insertPuc.run(
                    acc.Codigo,
                    acc.Nombre,
                    acc.ManejoDeTercero || 0,
                    reqCc,
                    acc.Inactivo ? 0 : 1,
                    parentCode || null
                );
            }
            db.exec("COMMIT;");
            console.log('PUC successfully migrated to SQLite.');
        } catch (e) {
            db.exec("ROLLBACK;");
            throw new Error(`PUC SQLite write failed: ${e.message}`);
        }
    }

    // 2. Save Terceros
    if (data.terceros.length > 0) {
        db.exec("DELETE FROM terceros;");
        const insertTercero = db.prepare(`
            INSERT OR IGNORE INTO terceros (
                tipo_identificacion, identificacion, dv, nombre, apellidos, 
                direccion, ciudad, telefono, email, 
                tipo_cliente, tipo_proveedor, tipo_empleado, 
                aplica_rete_ica, aplica_rete_fte, tarifa_ica, activo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        db.exec("BEGIN TRANSACTION;");
        try {
            for (const t of data.terceros) {
                const firstName = (t.Primer_Nombre || '').trim();
                const secondName = (t.Segundo_Nombre || '').trim();
                const firstLastName = (t.Primer_Apellido || '').trim();
                const secondLastName = (t.Segundo_Apellido || '').trim();
                
                let nombre = firstName;
                if (secondName) nombre += ' ' + secondName;
                
                let apellidos = firstLastName;
                if (secondLastName) apellidos += ' ' + secondLastName;
                
                // If it is a corporate client, standard stored under Primer_Nombre
                if (!nombre && !apellidos) continue;

                insertTercero.run(
                    (t.Tipo_Identificacion || 'NIT').trim(),
                    t.Identificacion,
                    t.DV ? String(t.DV).trim() : null,
                    nombre || 'Sin nombre',
                    apellidos || null,
                    t.Direccion ? t.Direccion.trim() : null,
                    t.Ciudad ? t.Ciudad.trim() : 'Bogotá',
                    t.Telefono ? String(t.Telefono).trim() : null,
                    t.EMail ? t.EMail.trim() : null,
                    1, 1, 0, // client=1, vendor=1, employee=0
                    t.Aplica_ReteIca || 0,
                    0,
                    t.Tarifa_ICA || 0,
                    t.Activo ? 1 : 0
                );
            }
            db.exec("COMMIT;");
            console.log('Terceros successfully migrated to SQLite.');
        } catch (e) {
            db.exec("ROLLBACK;");
            throw new Error(`Terceros SQLite write failed: ${e.message}`);
        }
    }

    // 3. Save Inventario
    if (data.inventario.length > 0) {
        db.exec("DELETE FROM inventario;");
        const insertInventario = db.prepare(`
            INSERT OR IGNORE INTO inventario (
                codigo, descripcion, marca, compatibilidad, stock_actual, stock_minimo, precio_venta, costo, iva_tarifa, activo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        db.exec("BEGIN TRANSACTION;");
        try {
            for (const item of data.inventario) {
                insertInventario.run(
                    item.Codigo,
                    item.Descripcion,
                    item.Marca ? item.Marca.trim() : null,
                    item.Compatibilidad ? item.Compatibilidad.trim() : null,
                    0, // initial stock 0
                    item.StockMinimo || 0,
                    item.Precio || 0,
                    (item.Precio || 0) * 0.6,
                    item.Iva || 19,
                    item.Activo ? 1 : 0
                );
            }
            db.exec("COMMIT;");
            console.log('Inventario successfully migrated to SQLite.');
        } catch (e) {
            db.exec("ROLLBACK;");
            throw new Error(`Inventario SQLite write failed: ${e.message}`);
        }
    }

    return {
        pucCount: data.puc.length,
        tercerosCount: data.terceros.length,
        inventarioCount: data.inventario.length
    };
}

async function importTreintaInventory(tenantId, excelFilePath) {
    console.log(`Starting Treinta Excel migration for tenant '${tenantId}' from: ${excelFilePath}`);
    const db = getTenantDb(tenantId);
    const tempScriptPath = path.join(__dirname, `temp_excel_migration_${Date.now()}.ps1`);
    const tempJsonPath = path.join(__dirname, `temp_excel_output_${Date.now()}.json`);
    const formattedJsonPath = tempJsonPath.replace(/\\/g, '/');
    const formattedExcelPath = excelFilePath.replace(/\\/g, '/');

    const psScript = `
        $excelPath = "${formattedExcelPath}"
        if (-not (Test-Path $excelPath)) {
            Write-Error "Excel file not found at: $excelPath"
            exit 1
        }

        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        try {
            $workbook = $excel.Workbooks.Open($excelPath)
            $sheet = $workbook.Sheets.Item(1)
            
            # Scan for the header row where Column 3 is "Nombre"
            $headerRow = 0
            for ($r = 1; $r -le 25; $r++) {
                if ($sheet.Cells.Item($r, 3).Text.Trim() -eq "Nombre") {
                    $headerRow = $r
                    break
                }
            }
            if ($headerRow -eq 0) {
                # Fallback to row 7 if not found
                $headerRow = 7
            }
            
            $rows = New-Object System.Collections.Generic.List[PSObject]
            $row = $headerRow + 1 # First data record starts after header row
            while ($true) {
                $name = $sheet.Cells.Item($row, 3).Text # Col 3 is Nombre
                if ([string]::IsNullOrEmpty($name) -or $name.Trim() -eq "") {
                    $nextName = $sheet.Cells.Item($row + 1, 3).Text
                    if ([string]::IsNullOrEmpty($nextName) -or $nextName.Trim() -eq "") {
                        break
                    }
                }
                
                $obj = New-Object PSObject
                $obj | Add-Member -MemberType NoteProperty -Name 'Nombre' -Value $name.Trim()
                $obj | Add-Member -MemberType NoteProperty -Name 'Categoria' -Value $sheet.Cells.Item($row, 4).Text.Trim()
                $obj | Add-Member -MemberType NoteProperty -Name 'Notas' -Value $sheet.Cells.Item($row, 5).Text.Trim()
                
                $qtyText = $sheet.Cells.Item($row, 6).Text.Trim()
                $costText = $sheet.Cells.Item($row, 7).Text.Trim()
                $priceText = $sheet.Cells.Item($row, 8).Text.Trim()
                
                $qty = 0.0
                if ($qtyText) {
                    $qtyTextClean = $qtyText.Replace(".", "").Replace(",", ".")
                    if ([double]::TryParse($qtyTextClean, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$qty)) {}
                }
                
                $cost = 0.0
                if ($costText) {
                    $costTextClean = $costText.Replace(".", "").Replace(",", ".")
                    if ([double]::TryParse($costTextClean, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$cost)) {}
                }
                
                $price = 0.0
                if ($priceText) {
                    $priceTextClean = $priceText.Replace(".", "").Replace(",", ".")
                    if ([double]::TryParse($priceTextClean, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$price)) {}
                }
                
                $obj | Add-Member -MemberType NoteProperty -Name 'Cantidad' -Value $qty
                $obj | Add-Member -MemberType NoteProperty -Name 'Costo' -Value $cost
                $obj | Add-Member -MemberType NoteProperty -Name 'Precio' -Value $price
                
                $rows.Add($obj)
                $row++
            }
            $workbook.Close($false)
            
            $json = $rows | ConvertTo-Json -Depth 5 -Compress
            $json = $json -replace '\\p{Cc}', ' '
            [System.IO.File]::WriteAllText("${formattedJsonPath}", $json, [System.Text.Encoding]::UTF8)
        } catch {
            if ($excel) {
                try { $workbook.Close($false) } catch {}
            }
            Write-Error $_.Exception.Message
            exit 1
        } finally {
            if ($excel) {
                $excel.Quit()
                [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
            }
        }
    `;

    // Write temp script
    fs.writeFileSync(tempScriptPath, psScript, { encoding: 'utf8' });

    // Spawn PowerShell
    const data = await new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', tempScriptPath
        ]);

        let stderr = '';
        ps.stderr.on('data', chunk => { stderr += chunk.toString(); });

        ps.on('close', code => {
            // Clean up temp script file
            try {
                if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
            } catch(e) {}

            if (code !== 0) {
                try {
                    if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
                } catch(e) {}
                return reject(new Error(`PowerShell returned code ${code}. Stderr: ${stderr}`));
            }

            // Read the data file
            try {
                if (!fs.existsSync(tempJsonPath)) {
                    return resolve([]);
                }
                let content = fs.readFileSync(tempJsonPath, 'utf8');
                if (content.charCodeAt(0) === 0xFEFF) {
                    content = content.slice(1);
                }
                fs.unlinkSync(tempJsonPath);
                
                if (!content.trim()) return resolve([]);
                resolve(JSON.parse(content));
            } catch (err) {
                reject(new Error(`JSON parse error of Excel output file contents: ${err.message}`));
            }
        });
    });

    console.log(`Excel parsed: found ${data.length} items.`);

    // --- SQLite Insertion ---
    if (data.length > 0) {
        db.exec("DELETE FROM inventario;");
        const insertInventario = db.prepare(`
            INSERT INTO inventario (
                codigo, descripcion, marca, compatibilidad, stock_actual, stock_minimo, precio_venta, costo, iva_tarifa, activo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        db.exec("BEGIN TRANSACTION;");
        try {
            data.forEach((item, index) => {
                const code = `TR-${String(index + 1).padStart(4, '0')}`;
                insertInventario.run(
                    code,
                    item.Nombre,
                    item.Categoria || null,
                    item.Notas || null,
                    item.Cantidad || 0,
                    0, // stock_minimo
                    item.Precio || 0,
                    item.Costo || 0,
                    19.0, // Default 19% VAT
                    1 // Activo
                );
            });
            db.exec("COMMIT;");
            console.log(`Successfully imported ${data.length} items from Treinta Excel to SQLite.`);
        } catch (e) {
            db.exec("ROLLBACK;");
            throw new Error(`Treinta Excel SQLite write failed: ${e.message}`);
        }
    }

    return {
        inventarioCount: data.length
    };
}

module.exports = {
    migrateImportadora,
    importTreintaInventory
};

