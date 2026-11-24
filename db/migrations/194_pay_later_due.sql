-- A registration a League Owner registered from a cart to be paid later (192): due the day before its first event.
alter table scenic_registrations add column pay_later_due date;
