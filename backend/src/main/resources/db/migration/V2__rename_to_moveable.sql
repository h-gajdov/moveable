-- Product renamed from Accessible Skopje to MoveAble.
UPDATE data_source SET name = 'MoveAble community obstacle reports', attribution = 'MoveAble contributors'
WHERE code = 'user_reports';
UPDATE data_source SET name = 'Values derived by the MoveAble pipeline'
WHERE code = 'derived';
