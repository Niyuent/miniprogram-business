-- point_transactions.sourceRole
ALTER TABLE `point_transactions`
  ADD COLUMN `sourceRole` ENUM('MAIN', 'SUB') NULL;
