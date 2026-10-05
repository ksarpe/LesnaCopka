-- WYGENEROWANE przez scripts/gen-seed.ts z src/data/mock – nie edytuj ręcznie.
-- Kody TERYT z assets/geo/gminy-index.geo (npm run geo:build); granice (boundary) uzupełnia import PRG (GUGiK).

insert into public.forest_regions (id, name) values
  ('puszcza-knyszynska', 'Puszcza Knyszyńska'),
  ('lasy-podlasia', 'Lasy Podlasia'),
  ('puszcza-bialowieska', 'Puszcza Białowieska')
on conflict (id) do nothing;

insert into public.gminy (id, teryt, name, voivodeship, forest_region_id, tile_row, tile_col) values
  ('wasilkow', '2002133', 'Wasilków', 'podlaskie', 'puszcza-knyszynska', 0, 2),
  ('czarna-bialostocka', '2002023', 'Czarna Białostocka', 'podlaskie', 'puszcza-knyszynska', 0, 3),
  ('dobrzyniewo-duze', '2002032', 'Dobrzyniewo Duże', 'podlaskie', 'puszcza-knyszynska', 0, 4),
  ('choroszcz', '2002013', 'Choroszcz', 'podlaskie', 'lasy-podlasia', 0, 5),
  ('zabludow', '2002143', 'Zabłudów', 'podlaskie', 'puszcza-knyszynska', 1, 1),
  ('juchnowiec-koscielny', '2002052', 'Juchnowiec Kościelny', 'podlaskie', 'lasy-podlasia', 1, 2),
  ('bialowieza', '2005022', 'Białowieża', 'podlaskie', 'puszcza-bialowieska', 1, 3),
  ('dubicze-cerkiewne', '2005052', 'Dubicze Cerkiewne', 'podlaskie', 'puszcza-bialowieska', 1, 4),
  ('czyze', '2005042', 'Czyże', 'podlaskie', 'puszcza-bialowieska', 1, 5),
  ('kleszczele', '2005073', 'Kleszczele', 'podlaskie', 'puszcza-bialowieska', 1, 6),
  ('szudzialowo', '2011102', 'Szudziałowo', 'podlaskie', 'puszcza-knyszynska', 2, 0),
  ('sokolka', '2011083', 'Sokółka', 'podlaskie', 'puszcza-knyszynska', 2, 1),
  ('krynki', '2011043', 'Krynki', 'podlaskie', 'puszcza-knyszynska', 2, 2),
  ('grodek', '2002042', 'Gródek', 'podlaskie', 'puszcza-knyszynska', 2, 3),
  ('hajnowka', '2005062', 'Hajnówka', 'podlaskie', 'puszcza-bialowieska', 2, 4),
  ('janow', '2011022', 'Janów', 'podlaskie', 'puszcza-knyszynska', 2, 5),
  ('sidra', '2011072', 'Sidra', 'podlaskie', 'lasy-podlasia', 2, 6),
  ('korycin', '2011032', 'Korycin', 'podlaskie', 'lasy-podlasia', 2, 7),
  ('knyszyn', '2008043', 'Knyszyn', 'podlaskie', 'puszcza-knyszynska', 3, 1),
  ('tykocin', '2002123', 'Tykocin', 'podlaskie', 'lasy-podlasia', 3, 2),
  ('narewka', '2005092', 'Narewka', 'podlaskie', 'puszcza-bialowieska', 3, 3),
  ('michalowo', '2002073', 'Michałowo', 'podlaskie', 'puszcza-knyszynska', 3, 4),
  ('suprasl', '2002093', 'Supraśl', 'podlaskie', 'puszcza-knyszynska', 3, 5),
  ('lapy', '2002063', 'Łapy', 'podlaskie', 'lasy-podlasia', 3, 6),
  ('turosn-koscielna', '2002112', 'Turośń Kościelna', 'podlaskie', 'lasy-podlasia', 3, 7),
  ('zawady', '2002152', 'Zawady', 'podlaskie', 'lasy-podlasia', 4, 2),
  ('narew', '2005082', 'Narew', 'podlaskie', 'puszcza-bialowieska', 4, 3),
  ('bocki', '2003042', 'Boćki', 'podlaskie', 'lasy-podlasia', 4, 4),
  ('orla', '2003062', 'Orla', 'podlaskie', 'lasy-podlasia', 4, 5),
  ('wyszki', '2003082', 'Wyszki', 'podlaskie', 'lasy-podlasia', 4, 6),
  ('bransk', '2003052', 'Brańsk', 'podlaskie', 'lasy-podlasia', 5, 1),
  ('bielsk-podlaski', '2003032', 'Bielsk Podlaski', 'podlaskie', 'lasy-podlasia', 5, 2),
  ('czeremcha', '2005032', 'Czeremcha', 'podlaskie', 'puszcza-bialowieska', 5, 3),
  ('milejczyce', '2010062', 'Milejczyce', 'podlaskie', 'lasy-podlasia', 5, 4),
  ('nurzec-stacja', '2010072', 'Nurzec-Stacja', 'podlaskie', 'lasy-podlasia', 5, 5),
  ('siemiatycze', '2010092', 'Siemiatycze', 'podlaskie', 'lasy-podlasia', 6, 2),
  ('drohiczyn', '2010023', 'Drohiczyn', 'podlaskie', 'lasy-podlasia', 6, 3),
  ('mielnik', '2010052', 'Mielnik', 'podlaskie', 'lasy-podlasia', 6, 4)
on conflict (id) do nothing;

insert into public.species (id, atlas_no, name, latin, short_name, rarity, edibility, habitat, clustered, typical_cap_cm, typical_height_cm, typical_weight_g) values
  ('borowik-szlachetny', 1, 'Borowik szlachetny', 'Boletus edulis', 'borowik', 'rzadki', 'jadalny', 'Las iglasty', false, 12, 14, 320),
  ('podgrzybek-brunatny', 2, 'Podgrzybek brunatny', 'Imleria badia', 'podgrzybek', 'pospolity', 'jadalny', 'Las iglasty', false, 9, 10, 120),
  ('czubajka-kania', 3, 'Czubajka kania', 'Macrolepiota procera', 'kania', 'epicki', 'jadalny', 'Polany i skraje lasu', false, 24, 28, 220),
  ('muchomor-czerwony', 4, 'Muchomor czerwony', 'Amanita muscaria', 'muchomor', 'pospolity', 'trujacy', 'Las mieszany', false, 13, 16, 180),
  ('pieprznik-jadalny', 5, 'Pieprznik jadalny (kurka)', 'Cantharellus cibarius', 'kurka', 'pospolity', 'jadalny', 'Las mieszany', true, 5, 6, 14),
  ('mleczaj-rydz', 6, 'Mleczaj rydz', 'Lactarius deliciosus', 'rydz', 'rzadki', 'jadalny', 'Młode bory sosnowe', false, 8, 6, 90),
  ('szmaciak-galezisty', 7, 'Szmaciak gałęzisty', 'Sparassis crispa', 'szmaciak', 'legendarny', 'jadalny', 'U podstawy sosen', false, 30, 20, 1400),
  ('muchomor-zielonawy', 8, 'Muchomor zielonawy', 'Amanita phalloides', 'muchomor', 'rzadki', 'smiertelny', 'Lasy liściaste', false, 9, 12, 90),
  ('smardz-jadalny', 9, 'Smardz jadalny', 'Morchella esculenta', 'smardz', 'epicki', 'jadalny', 'Wiosną, łęgi', false, 6, 10, 60),
  ('maslak-zwyczajny', 10, 'Maślak zwyczajny', 'Suillus luteus', 'maślak', 'pospolity', 'jadalny', 'Bory sosnowe', false, 8, 7, 70),
  ('kozlarz-babka', 11, 'Koźlarz babka', 'Leccinum scabrum', 'koźlarz', 'pospolity', 'jadalny', 'Pod brzozami', false, 9, 13, 110),
  ('kozlarz-czerwony', 12, 'Koźlarz czerwony', 'Leccinum aurantiacum', 'koźlarz', 'rzadki', 'jadalny', 'Pod osikami', false, 12, 15, 190),
  ('soplowka-jezowata', 13, 'Soplówka jeżowata', 'Hericium erinaceus', 'soplówka', 'legendarny', 'jadalny', 'Stare buki i dęby', false, 20, 15, 600),
  ('gaska-zielonka', 14, 'Gąska zielonka', 'Tricholoma equestre', 'gąska', 'pospolity', 'niejadalny', 'Piaszczyste bory', false, 8, 7, 60),
  ('opienka-miodowa', 15, 'Opieńka miodowa', 'Armillaria mellea', 'opieńka', 'pospolity', 'jadalny', 'Pnie i korzenie', true, 6, 9, 25),
  ('piestrzenica-kasztanowata', 16, 'Piestrzenica kasztanowata', 'Gyromitra esculenta', 'piestrzenica', 'rzadki', 'smiertelny', 'Wiosną, bory', false, 8, 9, 70),
  ('purchawka-chropowata', 17, 'Purchawka chropowata', 'Lycoperdon perlatum', 'purchawka', 'pospolity', 'jadalny', 'Ściółka leśna', false, 4, 6, 30),
  ('golabek-zielonawy', 18, 'Gołąbek zielonawy', 'Russula virescens', 'gołąbek', 'rzadki', 'jadalny', 'Buczyny i dąbrowy', false, 10, 8, 110),
  ('zagwica-listkowata', 19, 'Żagwica listkowata', 'Grifola frondosa', 'żagwica', 'epicki', 'jadalny', 'U podstawy dębów', false, 25, 18, 900),
  ('goryczak-zolciowy', 20, 'Goryczak żółciowy', 'Tylopilus felleus', 'goryczak', 'pospolity', 'niejadalny', 'Las iglasty', false, 10, 11, 150),
  ('borowik-ceglastopory', 21, 'Borowik ceglastopory', 'Neoboletus erythropus', 'ceglasty', 'rzadki', 'jadalny', 'Bory świerkowe', false, 12, 12, 250),
  ('muchomor-plamisty', 22, 'Muchomor plamisty', 'Amanita pantherina', 'muchomor', 'pospolity', 'trujacy', 'Lasy mieszane', false, 9, 11, 90),
  ('borowik-krolewski', 23, 'Borowik królewski', 'Butyriboletus regius', 'królewski', 'legendarny', 'jadalny', 'Ciepłe buczyny', false, 14, 12, 380),
  ('plachetka-zwyczajna', 24, 'Płachetka zwyczajna', 'Cortinarius caperatus', 'płachetka', 'pospolity', 'jadalny', 'Bory sosnowe', false, 9, 11, 80),
  ('czernidlak-kolpakowaty', 25, 'Czernidłak kołpakowaty', 'Coprinus comatus', 'czernidłak', 'pospolity', 'jadalny', 'Łąki i pobocza', false, 5, 15, 50),
  ('zaslonak-rudy', 26, 'Zasłonak rudy', 'Cortinarius orellanus', 'zasłonak', 'epicki', 'smiertelny', 'Lasy liściaste', false, 6, 8, 35),
  ('sarniak-dachowkowaty', 27, 'Sarniak dachówkowaty', 'Sarcodon imbricatus', 'sarniak', 'rzadki', 'jadalny', 'Bory świerkowe', false, 15, 8, 260),
  ('maslak-sitarz', 28, 'Maślak sitarz', 'Suillus bovinus', 'sitarz', 'pospolity', 'jadalny', 'Bory sosnowe', true, 6, 5, 40),
  ('kozlarz-pomaranczowozolty', 29, 'Koźlarz pomarańczowożółty', 'Leccinum versipelle', 'koźlarz', 'rzadki', 'jadalny', 'Pod brzozami', false, 13, 16, 210),
  ('lejkowiec-dety', 30, 'Lejkowiec dęty', 'Craterellus cornucopioides', 'lejkowiec', 'rzadki', 'jadalny', 'Buczyny', true, 5, 8, 12),
  ('mleczaj-smaczny', 31, 'Mleczaj smaczny', 'Lactarius volemus', 'mleczaj', 'rzadki', 'jadalny', 'Lasy mieszane', false, 10, 9, 120),
  ('siedzun-sosnowy', 32, 'Siedzuń sosnowy', 'Sparassis nemecii', 'siedzuń', 'epicki', 'jadalny', 'Stare sosny', false, 22, 16, 700),
  ('borowik-szatanski', 33, 'Borowik szatański', 'Rubroboletus satanas', 'szatan', 'epicki', 'trujacy', 'Wapienne buczyny', false, 18, 12, 450),
  ('lakowka-ametystowa', 34, 'Lakówka ametystowa', 'Laccaria amethystina', 'lakówka', 'pospolity', 'jadalny', 'Lasy mieszane', true, 4, 6, 8),
  ('gaska-siarkowa', 35, 'Gąska siarkowa', 'Tricholoma sulphureum', 'gąska', 'pospolity', 'niejadalny', 'Lasy liściaste', false, 6, 7, 40),
  ('strzepiak-ceglasty', 36, 'Strzępiak ceglasty', 'Inocybe erubescens', 'strzępiak', 'rzadki', 'smiertelny', 'Parki i buczyny', false, 6, 8, 30)
on conflict (id) do nothing;

insert into public.species_lookalikes (species_id, lookalike_name, lookalike_id, lookalike_edibility, tip) values
  ('borowik-szlachetny', 'goryczak żółciowy', 'goryczak-zolciowy', 'niejadalny', 'Sprawdź siateczkę na trzonie i kolor rurek.'),
  ('podgrzybek-brunatny', 'goryczak żółciowy', 'goryczak-zolciowy', 'niejadalny', 'Goryczak ma różowawe rurki i ciemną siateczkę na trzonie.'),
  ('czubajka-kania', 'muchomor sromotnikowy', null, 'smiertelny', 'Kania ma ruchomy pierścień i wężykowaty wzór na trzonie, bez pochwy u podstawy.'),
  ('pieprznik-jadalny', 'lisówka pomarańczowa', null, 'niejadalny', 'Kurka ma grube, rozwidlone listewki zamiast cienkich blaszek.'),
  ('mleczaj-rydz', 'mleczaj wełnianka', null, 'trujacy', 'Rydz wydziela pomarańczowe mleczko; wełnianka – białe i ma kosmaty brzeg.'),
  ('smardz-jadalny', 'piestrzenica kasztanowata', 'piestrzenica-kasztanowata', 'smiertelny', 'Smardz ma pusty w środku owocnik i regularne komory na kapeluszu.'),
  ('golabek-zielonawy', 'muchomor zielonawy', 'muchomor-zielonawy', 'smiertelny', 'Gołąbek nie ma pierścienia ani pochwy u podstawy trzonu.'),
  ('goryczak-zolciowy', 'borowik szlachetny', 'borowik-szlachetny', 'jadalny', 'Goryczak ma różowe rurki i ciemną siateczkę.'),
  ('borowik-ceglastopory', 'borowik szatański', 'borowik-szatanski', 'trujacy', 'Szatan ma biały kapelusz i siateczkę na trzonie – ceglastopory jest kropkowany.')
on conflict do nothing;

insert into public.badges (id, name, description, icon, color, icon_color, sort, rule) values
  ('krol-puszczy', 'Król Puszczy', '10 borowików w Puszczy Knyszyńskiej', 'military_tech', '#EFA831', '#4A3200', 0, '{"type":"species_in_region","species":"borowik-szlachetny","region":"puszcza-knyszynska","count":10}'),
  ('ranny-ptaszek', 'Ranny ptaszek', 'Wyprawa rozpoczęta przed 6:00', 'wb_twilight', '#2B99E7', '#0E2442', 1, '{"type":"early_bird","before":"06:00"}'),
  ('km-100', '100 km', '100 km przebytych na wyprawach', 'hiking', '#7FB547', '#1F3310', 2, '{"type":"distance_km","km":100}'),
  ('seria-7', 'Seria 7 dni', '7 dni z rzędu w lesie', 'local_fire_department', '#A56CDE', '#2A0D3A', 3, '{"type":"streak","days":7}'),
  ('lowca-legend', 'Łowca Legend', 'Znajdź gatunek legendarny', 'diamond', '#EFA831', '#4A3200', 4, '{"type":"rarity_find","rarity":"legendarny","count":1}')
on conflict (id) do nothing;

insert into public.quest_templates (id, kind, title, icon, icon_filled, icon_bg, icon_color, xp, target, sort) values
  ('q-scan-5', 'scans', 'Zeskanuj 5 grzybów', 'photo_camera', false, '#EEF5E3', '#4C7A22', 100, 5, 0),
  ('q-rare-1', 'rare', 'Znajdź rzadki gatunek', 'diamond', true, '#E9EEF9', '#0068B2', 150, 1, 1),
  ('q-km-5', 'distance', 'Przejdź 5 km', 'hiking', false, '#FFF0DD', '#A2560F', 80, 5, 2)
on conflict (id) do nothing;

insert into public.gmina_challenges (gmina_id, species_id, title, description, xp, badge_id)
select 'suprasl', 'szmaciak-galezisty', 'Znajdź szmaciaka gałęzistego', 'Tylko 4 osoby znalazły go tu w tym sezonie.', 500, 'lowca-legend'
where not exists (select 1 from public.gmina_challenges where gmina_id = 'suprasl' and species_id = 'szmaciak-galezisty');
