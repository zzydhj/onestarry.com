ALTER TABLE "stock_movements" ADD CONSTRAINT "sm_qty_sign" CHECK (case
                when "type" in ('sale', 'damage') then "quantity" < 0
                when "type" in ('receive', 'return') then "quantity" > 0
                else "quantity" <> 0
            end);