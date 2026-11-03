-- Sample data to test the app and the transaction log. Run once in SQL Editor.
-- Each insert/update below is recorded in the Transactions screen (user shows as "System").
insert into sales_orders (id, customer, pono, item, qty, date, due, status) values
 ('SO-TEST1','Tata Motors','PO-5521','Brake drum casting',50,current_date,current_date+30,'Open'),
 ('SO-TEST2','Ashok Leyland','AL-7780','Flywheel housing',20,current_date,current_date+45,'Open');

insert into work_orders (id, so, item, qty, start, due, status) values
 ('WO-TEST1','SO-TEST1','Brake drum casting',50,current_date+2,current_date+20,'Planned');

insert into indents (id, wo, item, qty, req, status) values
 ('IND-TEST1','WO-TEST1','Pig iron',12,current_date+3,'Open');

insert into purchase_orders (id, ind, vendor, item, qty, rate, gst, date) values
 ('PO-TEST1','IND-TEST1','Steel Traders Pvt Ltd','Pig iron',12,41000,'18',current_date);

insert into grns (id, po, item, qty, heat, date) values
 ('GRN-TEST1','PO-TEST1','Pig iron',12,'H-1042',current_date+4);

insert into fg_receipts (id, wo, item, qty, rej, date) values
 ('FGR-TEST1','WO-TEST1','Brake drum casting',48,2,current_date+18);

insert into spectro_reports (id, wo, sample, heat, date, comp, result) values
 ('SP-TEST1','WO-TEST1','S-01','H-1042',current_date+10,
  '[{"e":"C","min":"3.4","max":"3.8","ach":"3.6"},{"e":"Si","min":"2.2","max":"2.8","ach":"2.5"}]','Pass');

insert into mtcs (id, wo, spectro, customer, heat, qty, date) values
 ('MTC-TEST1','WO-TEST1','SP-TEST1','Tata Motors','H-1042',48,current_date+19);

insert into dispatch_notes (id, so, item, qty, date, vehicle, eway) values
 ('DN-TEST1','SO-TEST1','Brake drum casting',30,current_date+21,'MH12 AB 4455','EW-3300112');

insert into invoices (id, dn, customer, amount, gst, date) values
 ('INV-TEST1','DN-TEST1','Tata Motors',1250000,'18',current_date+21);

-- A few updates so the log shows "old -> new" changes
update indents set status = 'PO raised' where id = 'IND-TEST1';
update indents set status = 'Received' where id = 'IND-TEST1';
update sales_orders set status = 'Part dispatched' where id = 'SO-TEST1';
