import { randomUUID } from 'node:crypto';
import type { UserRole } from '@roller-bay/shared/users';
import type { Pool } from 'pg';

/**
 * Rows a test needs but is not about, written straight to the database so
 * they cost no requests and no permissions. Only state that several
 * integration files set up belongs here; SQL that is a test's own subject,
 * such as corrupting a row to prove a guard, stays in that test.
 */
export function createFixtures(pool: Pool) {
  return {
    setUserRole: (userId: string, role: UserRole) =>
      pool.query(`UPDATE users SET role=$1 WHERE id=$2`, [role, userId]),

    setUserActive: (userId: string, isActive: boolean) =>
      pool.query(`UPDATE users SET is_active=$1 WHERE id=$2`, [
        isActive,
        userId,
      ]),

    /** An employee who never signs in, to own what the session user must not. */
    async createUser(name: string) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO users (id,name,email,microsoft_subject_id,role) VALUES ($1,$2,$3,$4,'user')`,
        [id, name, `${id}@example.com`, id],
      );
      return id;
    },

    /** One 0.5 mm color and one location (section A, label 1), with parents. */
    async createColorAndLocation() {
      const ids = {
        manufacturer: randomUUID(),
        material: randomUUID(),
        color: randomUUID(),
        zone: randomUUID(),
        section: randomUUID(),
        location: randomUUID(),
      };
      await pool.query(
        `INSERT INTO manufacturers (id,name) VALUES ($1,'Fixture manufacturer')`,
        [ids.manufacturer],
      );
      await pool.query(
        `INSERT INTO fabric_materials (id,manufacturer_id,name) VALUES ($1,$2,'Fixture material')`,
        [ids.material, ids.manufacturer],
      );
      await pool.query(
        `INSERT INTO fabric_colors (id,material_id,code,thickness_mm) VALUES ($1,$2,'FIXTURE',0.5)`,
        [ids.color, ids.material],
      );
      await pool.query(
        `INSERT INTO location_zones (id,name) VALUES ($1,'Fixture warehouse')`,
        [ids.zone],
      );
      await pool.query(
        `INSERT INTO location_sections (id,zone_id,label) VALUES ($1,$2,'A')`,
        [ids.section, ids.zone],
      );
      await pool.query(
        `INSERT INTO locations (id,section_id,label) VALUES ($1,$2,'1')`,
        [ids.location, ids.section],
      );
      return ids;
    },

    /** Orders numbered `first` to `last`, each for one blind. */
    createWorkOrders: (first: number, last: number) =>
      pool.query(
        `INSERT INTO work_orders (order_number, ship_date, quantity)
           SELECT n::text, '2026-10-01', 1 FROM generate_series($1::int, $2::int) n`,
        [first, last],
      ),

    setOrderQuantity: (orderNumber: string, quantity: number) =>
      pool.query(`UPDATE work_orders SET quantity=$1 WHERE order_number=$2`, [
        quantity,
        orderNumber,
      ]),

    /** The order's raw row: milestones are asserted as stored, not as presented. */
    workOrder: async (orderNumber: string) =>
      (
        await pool.query(`SELECT * FROM work_orders WHERE order_number=$1`, [
          orderNumber,
        ])
      ).rows[0],
  };
}

export type Fixtures = ReturnType<typeof createFixtures>;
