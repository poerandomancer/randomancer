ALTER TABLE public_cards ADD COLUMN card_data_json TEXT;
ALTER TABLE public_cards ADD COLUMN meta_title TEXT;
ALTER TABLE public_cards ADD COLUMN meta_description TEXT;

UPDATE public_cards
SET card_data_json = COALESCE(card_data_json, json_object(
      'title', COALESCE(preview_title, 'Randomancer Shared Card'),
      'subtitle', COALESCE(preview_subtitle, ''),
      'footerText', 'Randomancer legacy share'
    )),
    meta_title = COALESCE(meta_title, preview_title, 'Randomancer Shared Card'),
    meta_description = COALESCE(meta_description, preview_description, 'A shared Randomancer artifact.');
