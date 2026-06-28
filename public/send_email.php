<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Content-Type: application/json; charset=UTF-8");

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(["success" => false, "error" => "Método no permitido."]);
    exit;
}

// Retrieve POST data
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data) {
    echo json_encode(["success" => false, "error" => "Datos de entrada no válidos o vacíos."]);
    exit;
}

$token = isset($data['token']) ? trim($data['token']) : '';
if ($token !== 'Patucarro2026*') {
    echo json_encode(["success" => false, "error" => "Token de seguridad inválido o no suministrado."]);
    exit;
}

$to = isset($data['to']) ? trim($data['to']) : '';
$subject = isset($data['subject']) ? trim($data['subject']) : '';
$body = isset($data['body']) ? trim($data['body']) : '';
$from_name = isset($data['from_name']) ? trim($data['from_name']) : 'SIMPLIX ERP';
$from_email = isset($data['from_email']) ? trim($data['from_email']) : 'no-reply@repuestoscajica.com';

if (empty($to) || empty($subject) || empty($body)) {
    echo json_encode(["success" => false, "error" => "Los campos 'to', 'subject' y 'body' son requeridos."]);
    exit;
}

if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    echo json_encode(["success" => false, "error" => "El correo electrónico del destinatario no es válido."]);
    exit;
}

// Format body as HTML (convert newlines to <br>)
$html_body = nl2br(htmlspecialchars($body));

// Domain email registered on Hostinger to guarantee SPF/DMARC delivery
$sender_domain_email = "facturas@repuestoscajica.com"; 

// Premium HTML Wrapper Template
$html_message = '
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>' . htmlspecialchars($subject) . '</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 20px 0;">
        <tr>
            <td align="center">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #1e3a8a, #2563eb); padding: 30px 40px; text-align: center;">
                            <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">' . htmlspecialchars($from_name) . '</h2>
                            <p style="color: #93c5fd; margin: 5px 0 0 0; font-size: 13px;">Documento Contable / Notificación</p>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px; color: #334155; font-size: 15px; line-height: 1.6;">
                            <div style="margin-bottom: 20px;">
                                ' . $html_body . '
                            </div>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 40px; text-align: center; font-size: 12px; color: #64748b;">
                            <p style="margin: 0 0 8px 0;">Este es un envío automático generado por <strong>Simplix ERP</strong> en nombre de ' . htmlspecialchars($from_name) . '.</p>
                            <p style="margin: 0;">Para consultas, escriba directamente a <a href="mailto:' . htmlspecialchars($from_email) . '" style="color: #2563eb; text-decoration: none; font-weight: 600;">' . htmlspecialchars($from_email) . '</a>.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
';

// Setup email headers
$headers = "MIME-Version: 1.0" . "\r\n";
$headers .= "Content-Type: text/html; charset=UTF-8" . "\r\n";
$headers .= "From: =?UTF-8?B?" . base64_encode($from_name) . "?= <" . $sender_domain_email . ">" . "\r\n";
$headers .= "Reply-To: " . $from_email . "\r\n";
$headers .= "X-Mailer: PHP/" . phpversion() . "\r\n";

// Execute mail sending
$mail_success = mail($to, "=?UTF-8?B?" . base64_encode($subject) . "?=", $html_message, $headers);

if ($mail_success) {
    echo json_encode(["success" => true, "message" => "Correo enviado con éxito."]);
} else {
    echo json_encode(["success" => false, "error" => "No se pudo realizar el envío del correo en el servidor PHP."]);
}
?>
