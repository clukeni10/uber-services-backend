import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

router.post("/:service_id/pay", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { service_id } = req.params;
    const { method, card_last4, phone } = req.body;
    const client_id = req.user?.id;

    const [payments]: any = await db.query(
      `SELECT * FROM payments WHERE service_id = ? AND client_id = ? AND status = 'pending'`,
      [service_id, client_id]
    );

    if (payments.length === 0) {
      res.status(404).json({ error: "Pagamento não encontrado ou já processado" });
      return;
    }

    const payment = payments[0];
    const reference = `REF${Date.now().toString().slice(-8)}`;

    // 1. Atualiza o estado do pagamento
    await db.query(
      `UPDATE payments SET status = 'paid', paid_at = NOW(), reference = ?, method = ?, card_last4 = ?, phone = ?
       WHERE service_id = ?`,
      [reference, method, card_last4 ?? null, phone ?? null, service_id]
    );

    // 2. Atualiza os ganhos do profissional
    await db.query(
      `UPDATE worker_profiles SET total_earnings = total_earnings + ? WHERE user_id = ?`,
      [payment.worker_earnings, payment.worker_id]
    );

    // [AQUI FICA A TUA LÓGICA DE INSERÇÃO NA TABELA `invoices`]
    // Exemplo (adapta para os teus campos reais caso mude):
    // await db.query(`INSERT INTO invoices (...) VALUES (...)`);

    // 3. Procura a fatura recém-criada com os JOINs necessários (Exatamente como fazes no GET)
    const [rows]: any = await db.query(
      `SELECT i.*,
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
       WHERE i.service_id = ?`,
      [service_id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "Erro ao gerar os dados da fatura para retorno" });
      return;
    }

    const row = rows[0];

    // 4. Mapeia a estrutura idêntica à esperada pelo teu Frontend
    const formattedInvoice = {
      id: row.id,
      service_id: row.service_id,
      client_id: row.client_id,
      worker_id: row.worker_id,
      reference: row.reference,
      amount: row.amount,
      platform_fee: row.platform_fee,
      worker_earnings: row.worker_earnings,
      method: row.method,
      description: row.service_description ?? row.description,
      issued_at: row.issued_at,
      scheduled_at: row.scheduled_at,
      category_name: row.category_name,
      client: {
        name: row.client_name,
        email: row.client_email,
        phone: row.client_phone,
        address: row.client_address
      },
      worker: {
        name: row.worker_name,
        email: row.worker_email,
        phone: row.worker_phone,
        specialty: row.specialty
      }
    };

    // 5. CRÍTICO: Responde ao Frontend com o objeto esperado!
    res.status(200).json({
      success: true,
      invoice_data: formattedInvoice
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao processar pagamento" });
  }
});
// GET /api/payments/invoices/client
router.get("/invoices/client", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query(
      `SELECT i.*,
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
       WHERE i.client_id = ?
       ORDER BY i.issued_at DESC`,
      [req.user?.id]
    );

    // Mapeia as linhas planas da BD para a estrutura aninhada esperada pelo React
    const formattedInvoices = rows.map((row: any) => ({
      id: row.id,
      service_id: row.service_id,
      client_id: row.client_id,
      worker_id: row.worker_id,
      reference: row.reference,
      amount: row.amount,
      platform_fee: row.platform_fee,
      worker_earnings: row.worker_earnings,
      method: row.method,
      description: row.service_description ?? row.description,
      issued_at: row.issued_at,
      scheduled_at: row.scheduled_at,
      category_name: row.category_name,
      client: {
        name: row.client_name,
        email: row.client_email,
        phone: row.client_phone,
        address: row.client_address
      },
      worker: {
        name: row.worker_name,
        email: row.worker_email,
        phone: row.worker_phone,
        specialty: row.specialty
      }
    }));

    res.json(formattedInvoices);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar faturas" });
  }
});

// GET /api/payments/invoice/:service_id
router.get("/invoice/:service_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query(
      `SELECT i.*,
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
       WHERE i.service_id = ?`,
      [req.params.service_id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "Fatura não encontrada" });
      return;
    }

    const row = rows[0];
    
    // Mapeia o objeto único de forma estruturada
    const formattedInvoice = {
      id: row.id,
      service_id: row.service_id,
      client_id: row.client_id,
      worker_id: row.worker_id,
      reference: row.reference,
      amount: row.amount,
      platform_fee: row.platform_fee,
      worker_earnings: row.worker_earnings,
      method: row.method,
      description: row.service_description ?? row.description,
      issued_at: row.issued_at,
      scheduled_at: row.scheduled_at,
      category_name: row.category_name,
      client: {
        name: row.client_name,
        email: row.client_email,
        phone: row.client_phone,
        address: row.client_address
      },
      worker: {
        name: row.worker_name,
        email: row.worker_email,
        phone: row.worker_phone,
        specialty: row.specialty
      }
    };

    res.json(formattedInvoice);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar fatura" });
  }
});

// GET /api/payments/invoices/worker
router.get("/invoices/worker", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query(`
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
      WHERE i.worker_id = ?
      ORDER BY i.issued_at DESC
    `, [req.user?.id]);

    // Mapeia o array plano para a estrutura de sub-objetos (client e worker)
    const formattedInvoices = rows.map((row: any) => ({
      id: row.id,
      service_id: row.service_id,
      client_id: row.client_id,
      worker_id: row.worker_id,
      reference: row.reference,
      amount: row.amount,
      platform_fee: row.platform_fee,
      worker_earnings: row.worker_earnings,
      method: row.method,
      description: row.service_description ?? row.description,
      issued_at: row.issued_at,
      scheduled_at: row.scheduled_at,
      category_name: row.category_name,
      client: {
        name: row.client_name,
        email: row.client_email,
        phone: row.client_phone, 
        address: row.client_address
      },
      worker: {
        name: row.worker_name,
        email: row.worker_email,
        phone: row.worker_phone,
        specialty: row.specialty
      }
    }));

    res.json(formattedInvoices);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar faturas" });
  }
});

export default router;