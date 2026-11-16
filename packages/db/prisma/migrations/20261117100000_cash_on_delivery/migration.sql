-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('online', 'cash_on_delivery');

-- AlterEnum
ALTER TYPE "order_status" ADD VALUE 'confirmed';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "payment_method" "payment_method" NOT NULL DEFAULT 'online';


-- ---------------------------------------------------------------------------
-- Hand-written from here.
-- ---------------------------------------------------------------------------

-- Allowed status steps, now including cash on delivery:
--   pending_payment -> paid | cancelled              (paid online)
--   confirmed       -> fulfilled | cancelled          (cash on delivery, before sending)
--   paid            -> fulfilled | cancelled | refunded
--   fulfilled       -> refunded | cancelled           (cancelled: a cash-on-delivery
--                                                      parcel refused at the door;
--                                                      the service allows it only
--                                                      while no money was taken)
CREATE OR REPLACE FUNCTION app_private.check_order_transition() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status::text, NEW.status::text) IN (
    ('pending_payment', 'paid'), ('pending_payment', 'cancelled'),
    ('confirmed', 'fulfilled'), ('confirmed', 'cancelled'),
    ('paid', 'fulfilled'), ('paid', 'cancelled'), ('paid', 'refunded'),
    ('fulfilled', 'refunded'), ('fulfilled', 'cancelled')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'orders.status: % cannot become %', OLD.status, NEW.status
    USING ERRCODE = '23514';
END
$$;

-- A cash-on-delivery order starts as confirmed; an online one waits for payment.
ALTER TABLE orders
  ADD CONSTRAINT orders_status_matches_method CHECK (
    (payment_method = 'online' AND status <> 'confirmed')
    OR (payment_method = 'cash_on_delivery' AND status NOT IN ('pending_payment', 'paid'))
  );

-- How the order is paid never changes after it is placed.
CREATE OR REPLACE FUNCTION app_private.freeze_order_amounts() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.subtotal_amount, NEW.shipping_amount, NEW.tax_amount, NEW.discount_amount,
      NEW.total_amount, NEW.currency, NEW.number, NEW.payment_method)
     IS DISTINCT FROM
     (OLD.subtotal_amount, OLD.shipping_amount, OLD.tax_amount, OLD.discount_amount,
      OLD.total_amount, OLD.currency, OLD.number, OLD.payment_method) THEN
    RAISE EXCEPTION 'orders: amounts, number and payment method cannot change after the order is placed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
