-- Removes the sample data (children first). The log keeps the delete entries.
delete from invoices where id like '%TEST%';
delete from dispatch_notes where id like '%TEST%';
delete from mtcs where id like '%TEST%';
delete from spectro_reports where id like '%TEST%';
delete from fg_receipts where id like '%TEST%';
delete from grns where id like '%TEST%';
delete from purchase_orders where id like '%TEST%';
delete from indents where id like '%TEST%';
delete from work_orders where id like '%TEST%';
delete from sales_orders where id like '%TEST%';
