import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

// POST /api/payments/:service_id/pay
router.post("/:service_id/pay", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { service_id } = req.params;
    const { method, card_last4, phone } = req.body;
    const client_id = req.user?.id;

    console.log("PAY REQUEST:", { service_id, method, client_id });

    // 1. Busca pagamento pendente
    const [payments]: any = await db.query(
      `SELECT * FROM payments WHERE service_id = ? AND client_id = ? AND status = 'pending'`,
      [service_id, client_id]
    );

    console.log("PAYMENTS FOUND:", payments.length);

    if (payments.length === 0) {
      res.status(404).json({ error: "Pagamento não encontrado ou já processado" });
      return;
    }

    const payment = payments[0];
    const reference = `REF${Date.now().toString().slice(-8)}`;

    // 2. Atualiza pagamento
    await db.query(
      `UPDATE payments 
       SET status = 'paid', paid_at = NOW(), reference = ?, method = ?, card_last4 = ?, phone = ?
       WHERE service_id = ?`,
      [reference, method, card_last4 ?? null, phone ?? null, service_id]
    );

    // 3. Atualiza ganhos do worker
    await db.query(
      `UPDATE worker_profiles SET total_earnings = total_earnings + ? WHERE user_id = ?`,
      [payment.worker_earnings, payment.worker_id]
    );

    // 4. Busca dados do serviço para a fatura
    const [serviceRows]: any = await db.query(
      `SELECT s.*,
              uc.name as client_name, uc.email as client_email, uc.phone as client_phone, uc.address as client_address,
              uw.name as worker_name, uw.email as worker_email, uw.phone as worker_phone,
              wp.specialty,
              c.name as category_name
       FROM services s
       INNER JOIN users uc ON uc.id = s.client_id
       INNER JOIN users uw ON uw.id = s.worker_id
       LEFT JOIN worker_profiles wp ON wp.user_id = s.worker_id
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.id = ?`,
      [service_id]
    );

    if (serviceRows.length === 0) {
      res.status(404).json({ error: "Serviço não encontrado" });
      return;
    }

    const service = serviceRows[0];

    // 5. Verifica se já existe fatura para este serviço
    const [existingInvoice]: any = await db.query(
      `SELECT id FROM invoices WHERE service_id = ?`,
      [service_id]
    );

    let invoiceId: number;

    if (existingInvoice.length > 0) {
      invoiceId = existingInvoice[0].id;
    } else {
      // Cria a fatura
      const [invoice]: any = await db.query(
        `INSERT INTO invoices (service_id, client_id, worker_id, reference, amount, platform_fee, worker_earnings, method, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          service_id,
          payment.client_id,
          payment.worker_id,
          reference,
          payment.amount,
          payment.platform_fee,
          payment.worker_earnings,
          method,
          service.description,
        ]
      );
      invoiceId = invoice.insertId;
    }

    console.log("INVOICE ID:", invoiceId);

    // 6. Monta o objeto da fatura para o frontend
    const invoice_data = {
      id: invoiceId,
      reference,
      issued_at: new Date().toISOString(),
      amount: parseFloat(payment.amount),
      platform_fee: parseFloat(payment.platform_fee),
      worker_earnings: parseFloat(payment.worker_earnings),
      method,
      description: service.description,
      scheduled_at: service.scheduled_at,
      category_name: service.category_name ?? "",
      client: {
        name: service.client_name ?? "",
        email: service.client_email ?? "",
        phone: service.client_phone ?? "",
        address: service.client_address ?? "",
      },
      worker: {
        name: service.worker_name ?? "",
        email: service.worker_email ?? "",
        phone: service.worker_phone ?? "",
        specialty: service.specialty ?? "",
      },
    };

    console.log("INVOICE DATA:", invoice_data);

    res.json({
      message: "Pagamento processado com sucesso",
      reference,
      invoice_id: invoiceId,
      invoice_data,
    });

  } catch (error) {
    console.error("ERRO NO PAGAMENTO:", error);
    res.status(500).json({ error: "Erro ao processar pagamento" });
  }
});

// helper de formatação reutilizável
function formatInvoiceRow(row: any) {
  return {
    id: row.id,
    service_id: row.service_id,
    reference: row.reference,
    amount: parseFloat(row.amount),
    platform_fee: parseFloat(row.platform_fee),
    worker_earnings: parseFloat(row.worker_earnings),
    method: row.method,
    description: row.service_description ?? row.description ?? "",
    issued_at: row.issued_at,
    scheduled_at: row.scheduled_at,
    category_name: row.category_name ?? "",
    client: {
      name: row.client_name ?? "",
      email: row.client_email ?? "",
      phone: row.client_phone ?? "",
      address: row.client_address ?? "",
    },
    worker: {
      name: row.worker_name ?? "",
      email: row.worker_email ?? "",
      phone: row.worker_phone ?? "",
      specialty: row.specialty ?? "",
    },
  };
}

const invoiceQuery = `
  SELECT i.*,
         uc.name as client_name, uc.email as client_email, uc.phone as client_phone, uc.address as client_address,
         uw.name as worker_name, uw.email as worker_email, uw.phone as worker_phone,
         wp.specialty,
         s.scheduled_at, s.description as service_description,
         c.name as category_name
  FROM invoices i
  INNER JOIN users uc ON uc.id = i.client_id
  INNER JOIN users uw ON uw.id = i.worker_id
  LEFT JOIN worker_profiles wp ON wp.user_id = i.worker_id
  INNER JOIN services s ON s.id = i.service_id
  LEFT JOIN categories c ON c.id = s.category_id
`;

// GET /api/payments/invoices/client
router.get("/invoices/client", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query(
      `${invoiceQuery} WHERE i.client_id = ? ORDER BY i.issued_at DESC`,
      [req.user?.id]
    );
    res.json(rows.map(formatInvoiceRow));
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar faturas" });
  }
});

// GET /api/payments/invoice/:service_id
router.get("/invoice/:service_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query(
      `${invoiceQuery} WHERE i.service_id = ?`,
      [req.params.service_id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Fatura não encontrada" });
      return;
    }
    res.json(formatInvoiceRow(rows[0]));
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar fatura" });
  }
});

// GET /api/payments/invoices/worker
router.get("/invoices/worker", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query(
      `${invoiceQuery} WHERE i.worker_id = ? ORDER BY i.issued_at DESC`,
      [req.user?.id]
    );
    res.json(rows.map(formatInvoiceRow));
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar faturas" });
  }
});

export default router;