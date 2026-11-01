-- Features (SPEC.md section 14): Partner Tools is retired. Team Building becomes Team Management (add teams and their
-- coaches); hosting is Hosting Sites Available only. An organization that used Partner Tools to host keeps hosting.
insert into org_features (org, feature, source, turned_on_by, turned_on_at)
select org, 'hosting-available', source, turned_on_by, turned_on_at from org_features f
where feature = 'partner-tools' and org <> 'thunder'
on conflict do nothing;
delete from org_features where feature = 'partner-tools';
delete from org_feature_requests where feature = 'partner-tools';
