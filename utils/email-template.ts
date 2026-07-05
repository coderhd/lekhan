export const getInvitationEmailHtml = (documentTitle: string, role: string, inviteLink: string, inviterName: string = 'A collaborator') => `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<style>
		body {
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
			background-color: #f4f5f7;
			margin: 0;
			padding: 40px 20px;
			color: #1a1a1a;
		}
		.container {
			max-width: 600px;
			margin: 0 auto;
			background-color: #ffffff;
			border-radius: 16px;
			overflow: hidden;
			box-shadow: 0 4px 24px rgba(0, 0, 0, 0.05);
			border: 1px solid rgba(0,0,0,0.05);
		}
		.header {
			background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
			padding: 32px;
			text-align: center;
		}
		.logo {
			color: #ffffff;
			font-size: 28px;
			font-weight: 800;
			letter-spacing: -0.5px;
			margin: 0;
		}
		.logo span {
			color: #3b82f6;
		}
		.content {
			padding: 40px 32px;
		}
		h1 {
			font-size: 24px;
			font-weight: 700;
			margin-top: 0;
			margin-bottom: 16px;
			color: #0f172a;
		}
		p {
			font-size: 16px;
			line-height: 1.6;
			margin: 0 0 24px 0;
			color: #475569;
		}
		.document-card {
			background-color: #f8fafc;
			border: 1px solid #e2e8f0;
			border-radius: 12px;
			padding: 20px;
			margin-bottom: 32px;
		}
		.doc-title {
			font-size: 18px;
			font-weight: 600;
			color: #0f172a;
			margin-bottom: 8px;
		}
		.doc-role {
			display: inline-block;
			background-color: #e0f2fe;
			color: #0369a1;
			font-size: 12px;
			font-weight: 700;
			padding: 4px 10px;
			border-radius: 9999px;
			text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.btn {
			display: inline-block;
			background-color: #3b82f6;
			color: #ffffff !important;
			font-weight: 600;
			font-size: 16px;
			text-decoration: none;
			padding: 14px 28px;
			border-radius: 8px;
			text-align: center;
			transition: background-color 0.2s;
		}
		.btn:hover {
			background-color: #2563eb;
		}
		.footer {
			background-color: #f8fafc;
			padding: 24px 32px;
			text-align: center;
			font-size: 13px;
			color: #64748b;
			border-top: 1px solid #e2e8f0;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h2 class="logo">Lekhan<span>.</span></h2>
		</div>
		<div class="content">
			<h1>You've been invited!</h1>
			<p><strong>${inviterName}</strong> has invited you to collaborate on a document in Lekhan.</p>
			
			<div class="document-card">
				<div class="doc-title">${documentTitle}</div>
				<span class="doc-role">Role: ${role}</span>
			</div>
			
			<p>Click the button below to accept the invitation and start collaborating instantly.</p>
			
			<div style="text-align: center; margin-top: 32px;">
				<a href="${inviteLink}" class="btn">Open Document</a>
			</div>
		</div>
		<div class="footer">
			<p>If you don't recognize this invitation, you can safely ignore this email.</p>
			<p>&copy; ${new Date().getFullYear()} Lekhan. All rights reserved.</p>
		</div>
	</div>
</body>
</html>
`
