import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

// GET /api/workers/me — TEM DE VIR PRIMEIRO
router.get("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
      console.log("GET /worker chamado, user id:", req.user?.id);

    try {
        const [rows]: any = await db.query(
            `SELECT u.id, u.name, u.email, u.phone, u.address, u.birthday, u.image,
              wp.specialty, wp.bio, wp.hourly_rate, wp.rating_avg, wp.is_available, wp.total_earnings
       FROM users u
       INNER JOIN worker_profiles wp ON wp.user_id = u.id
       WHERE u.id = ?`,
            [req.user?.id]
        );

        if (rows.length === 0) {
            res.status(404).json({ error: "Worker não encontrado" });
            return;
        }

        const w = rows[0];
        res.json({
            ...w,
            rating_avg: w.rating_avg ? parseFloat(w.rating_avg) : null,
            hourly_rate: w.hourly_rate ? parseFloat(w.hourly_rate) : null,
            total_earnings: w.total_earnings ? parseFloat(w.total_earnings) : 0,
        });
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar perfil" });
    }
});



// PUT /api/workers/me
router.put("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
    console.log("image size:", req.body.image?.length ?? 0);
    try {
        const { name, email, phone, address, birthday, image, specialty, bio, hourly_rate, is_available } = req.body;

        await db.query(
            `UPDATE users SET name=?, email=?, phone=?, address=?, birthday=?, image=? WHERE id=?`,
            [name, email, phone, address, birthday, image, req.user?.id]
        );

        await db.query(
            `UPDATE worker_profiles SET specialty=?, bio=?, hourly_rate=?, is_available=? WHERE user_id=?`,
            [specialty, bio, hourly_rate, is_available, req.user?.id]
        );

        res.json({ message: "Perfil atualizado com sucesso" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Erro ao atualizar perfil" });
    }
});

// GET /api/workers/category/:name — workers por categoria
router.get("/category/:name", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const [rows]: any = await db.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.image,
        wp.specialty, wp.bio, wp.hourly_rate, wp.rating_avg, wp.is_available
      FROM users u
      INNER JOIN worker_profiles wp ON wp.user_id = u.id
      WHERE u.role = 'worker' AND wp.specialty = ? AND wp.is_available = true
      ORDER BY wp.rating_avg DESC
    `, [req.params.name]);

        const workers = (rows as any[]).map((w) => ({
            ...w,
            rating_avg: w.rating_avg ? parseFloat(w.rating_avg) : null,
            hourly_rate: w.hourly_rate ? parseFloat(w.hourly_rate) : null,
        }));

        res.json(workers);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar workers por categoria" });
    }
});

// GET /api/workers/stats
router.get("/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const worker_id = req.user?.id;

    const [[services]]: any = await db.query(`
      SELECT
        COUNT(*) as total_services,
        SUM(status = 'pending')   as pending,
        SUM(status = 'accepted')  as accepted,
        SUM(status = 'active')    as active,
        SUM(status = 'completed') as completed,
        SUM(status = 'cancelled') as cancelled
      FROM services
      WHERE worker_id = ?
    `, [worker_id]);

    const [[earnings]]: any = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN worker_earnings ELSE 0 END), 0) as total_earnings,
        COALESCE(SUM(CASE WHEN status = 'paid' AND MONTH(paid_at) = MONTH(NOW()) AND YEAR(paid_at) = YEAR(NOW()) THEN worker_earnings ELSE 0 END), 0) as month_earnings
      FROM payments
      WHERE worker_id = ?
    `, [worker_id]);

    const [[rating]]: any = await db.query(`
      SELECT COALESCE(AVG(rating), 0) as avg_rating, COUNT(*) as total_reviews
      FROM reviews
      WHERE worker_id = ?
    `, [worker_id]);

    const [recentServices]: any = await db.query(`
      SELECT s.id, s.description, s.status, s.created_at, s.started_at,
             u.name as client_name, u.image as client_image
      FROM services s
      INNER JOIN users u ON u.id = s.client_id
      WHERE s.worker_id = ?
      ORDER BY s.created_at DESC
      LIMIT 5
    `, [worker_id]);

    res.json({
      services: {
        total:     services.total_services,
        pending:   services.pending,
        accepted:  services.accepted,
        active:    services.active,
        completed: services.completed,
        cancelled: services.cancelled,
      },
      earnings: {
        total: parseFloat(earnings.total_earnings),
        month: parseFloat(earnings.month_earnings),
      },
      rating: {
        avg:     parseFloat(earnings.avg_rating ?? 0),
        reviews: rating.total_reviews,
      },
      recentServices,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Erro ao buscar estatísticas" });
  }
});

// GET /api/workers/filters
router.get("/filters", async (req: AuthRequest, res: Response) => {
  try {
    // 1. Busca especialidades diretamente dos perfis existentes
    const [specialtiesRows]: any = await db.query(
      "SELECT DISTINCT specialty FROM worker_profiles WHERE specialty IS NOT NULL AND specialty != ''"
    );
    
    // 2. Busca os endereços brutos de quem é worker
    const [addressesRows]: any = await db.query(
      "SELECT DISTINCT address FROM users WHERE role = 'worker' AND address IS NOT NULL AND address != ''"
    );

    // 3. Formata as Categorias (Primeira letra maiúscula para ficar bonito na UI)
    const categories = (specialtiesRows as any[]).map(row => {
      const original = row.specialty;
      const formatado = original.charAt(0).toUpperCase() + original.slice(1).toLowerCase();
      return {
        label: formatado, // Ex: "Electricista"
        value: original.toLowerCase() // Ex: "electricista" (combina com o banco)
      };
    });

    // 4. Trata e limpa os Municípios de Luanda
    const citiesMap = new Map();
    
    (addressesRows as any[]).forEach(row => {
      // Se o endereço for "Viana, Luanda", separa pela vírgula e pega o "Viana"
      const parts = row.address.split(",");
      const rawCity = parts[0].trim(); 
      
      if (rawCity) {
        const label = rawCity.charAt(0).toUpperCase() + rawCity.slice(1).toLowerCase();
        const value = rawCity.toLowerCase();
        
        // O Map evita duplicados automaticamente
        citiesMap.set(value, { label, value });
      }
    });

    const cities = Array.from(citiesMap.values());

    // Retorna a estrutura exata que o frontend espera
    res.json({ categories, cities });
  } catch (error) {
    console.error("Erro na rota de filtros:", error);
    res.status(500).json({ error: "Erro ao carregar filtros dinâmicos" });
  }
});

// GET /api/workers/:id
router.get("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const [rows]: any = await db.query(
            `SELECT u.id, u.name, u.email, u.phone, u.address, u.image,
              wp.specialty, wp.bio, wp.hourly_rate, wp.rating_avg, wp.is_available
       FROM users u
       INNER JOIN worker_profiles wp ON wp.user_id = u.id
       WHERE u.id = ? AND u.role = 'worker'`,
            [req.params.id]
        );

        if (rows.length === 0) {
            res.status(404).json({ error: "Profissional não encontrado" });
            return;
        }

        const w = rows[0];
        res.json({
            ...w,
            rating_avg: w.rating_avg ? parseFloat(w.rating_avg) : null,
            hourly_rate: w.hourly_rate ? parseFloat(w.hourly_rate) : null,
        });
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar profissional" });
    }
});

// GET /api/workers — FICA POR ÚLTIMO
router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { search, category, city } = req.query;

        let query = `
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.image,
        wp.specialty, wp.bio, wp.hourly_rate, wp.rating_avg, wp.is_available
      FROM users u
      INNER JOIN worker_profiles wp ON wp.user_id = u.id
      WHERE u.role = 'worker'
    `;

        const params: any[] = [];

        if (search) {
            query += " AND (u.name LIKE ? OR wp.specialty LIKE ?)";
            params.push(`%${search}%`, `%${search}%`);
        }

        if (category) {
            query += " AND wp.specialty = ?";
            params.push(category);
        }

        if (city) {
            query += " AND u.address LIKE ?";
            params.push(`%${city}%`);
        }

        query += " ORDER BY wp.rating_avg DESC";

        const [rows]: any = await db.query(query, params);
        const workers = (rows as any[]).map((w) => ({
            ...w,
            rating_avg: w.rating_avg ? parseFloat(w.rating_avg) : null,
            hourly_rate: w.hourly_rate ? parseFloat(w.hourly_rate) : null,
        }));
        res.json(workers);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar profissionais" });
    }
});



export default router;