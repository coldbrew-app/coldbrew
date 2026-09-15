-- migrate:up
INSERT INTO donation_alert_source (user_id, source)
SELECT user_id, 'tourniquet' AS source
FROM donation_alert_configuration
ON CONFLICT (user_id, source) DO NOTHING;

-- migrate:down
DELETE FROM donation_alert_source
WHERE source = 'tourniquet';
