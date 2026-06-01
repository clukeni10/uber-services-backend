import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

// POST /api/services — cliente cria pedido
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { worker_id, category_id, description, scheduled_at, amount, method } = req.body;
        const client_id = req.user?.id;

        // Cria o serviço
        const [service]: any = await db.query(
            `INSERT INTO services (client_id, worker_id, category_id, description, scheduled_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
            [client_id, worker_id, category_id ?? null, description, scheduled_at]
        );

        const service_id = service.insertId;

        // Cria o pagamento
        await db.query(
            `INSERT INTO payments (service_id, client_id, worker_id, amount, method, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
            [service_id, client_id, worker_id, amount, method]
        );

        res.status(201).json({ message: "Serviço criado com sucesso", service_id });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Erro ao criar serviço" });
    }
});

export default router;