-- Seed: Las Vegas pilot location inventory
-- Source: Appendix A of joinzer_developer_handoff_v2.docx
--
-- Do NOT pre-sort here. Sort at query time: ORDER BY court_count DESC, name ASC
-- Run once after migrations. To re-seed, truncate locations first.
--
-- access_type mapping from Appendix A:
--   Public              → public
--   Fee-based           → fee_based
--   Resort              → resort
--   Private/Membership  → private
--   Private             → private
--   HOA/Public-limited  → hoa
--   Directory listing   → directory
--   Business/Indoor     → business
--   Indoor/Public       → indoor_public
--   Semi-private        → semi_private

insert into locations (name, metro_area, subarea, court_count, access_type, notes) values
  ('Sunset Park Pickleball Complex',                         'Las Vegas', 'Clark County',  24, 'public',       'Premier public complex; some courts reservable'),
  ('Black Mountain Recreation Center / Black Mountain Pickleball Park', 'Las Vegas', 'Henderson',    18, 'public',       'Major public facility'),
  ('The Pickleball Universe',                                'Las Vegas', null,             16, 'fee_based',    'Directory listing'),
  ('Plaza Hotel & Casino',                                   'Las Vegas', 'Las Vegas',      15, 'resort',       '14 permanent + 1 championship court'),
  ('Chicken N Pickle - Henderson',                           'Las Vegas', 'Henderson',      14, 'fee_based',    '8 outdoor + 6 indoor'),
  ('The Picklr Henderson',                                   'Las Vegas', 'Henderson',      11, 'private',      'Indoor facility'),
  ('Desert Vista Community Center',                          'Las Vegas', null,             10, 'private',      'Directory listing'),
  ('Hollywood Park / Hollywood Regional Park',               'Las Vegas', 'Clark County',    8, 'public',       null),
  ('Police Memorial Park',                                   'Las Vegas', 'Las Vegas',       8, 'public',       'Lights; recently renovated'),
  ('Sun City Aliante',                                       'Las Vegas', 'North Las Vegas',  8, 'private',     null),
  ('Westgate Las Vegas Resort & Casino',                     'Las Vegas', 'Las Vegas',       8, 'resort',       null),
  ('Durango Hills Park',                                     'Las Vegas', 'Las Vegas',       7, 'public',       'Lights; open play activity'),
  ('Canyon Gate Country Club',                               'Las Vegas', null,              6, 'private',      null),
  ('Regency of Summerlin',                                   'Las Vegas', null,              6, 'private',      null),
  ('Siena Community Association',                            'Las Vegas', null,              6, 'private',      null),
  ('Mr. Pickleball',                                         'Las Vegas', null,              5, 'directory',    'Directory listing'),
  ('Aloha Shores Park',                                      'Las Vegas', 'Las Vegas',       4, 'public',       null),
  ('Ardiente',                                               'Las Vegas', 'North Las Vegas',  4, 'private',     null),
  ('Bill Briare Park',                                       'Las Vegas', 'Las Vegas',       4, 'public',       null),
  ('Bob Baskin Park',                                        'Las Vegas', null,              4, 'directory',    'Directory listing'),
  ('Bob Price Park / Robert E. ''Bob'' Price Recreation Center', 'Las Vegas', 'Clark County', 4, 'public',      null),
  ('Lone Mountain Regional Park',                            'Las Vegas', 'Clark County',    4, 'public',       null),
  ('Lorenzi Park',                                           'Las Vegas', 'Las Vegas',       4, 'public',       null),
  ('Montagna Park',                                          'Las Vegas', 'Henderson',       4, 'public',       'Newer park in Inspirada'),
  ('Oak Leaf Park (Summerlin HOA Park)',                     'Las Vegas', 'Clark County',    4, 'hoa',          'Access may be more limited'),
  ('Oak Leaf Park Pickleball Courts',                        'Las Vegas', null,              4, 'directory',    'Directory listing'),
  ('Reverence Pickleball Courts',                            'Las Vegas', null,              4, 'private',      null),
  ('Southern Highlands Racquets',                            'Las Vegas', null,              4, 'private',      null),
  ('Spanish Oaks Tennis Club',                               'Las Vegas', null,              4, 'private',      null),
  ('Whitney Mesa',                                           'Las Vegas', 'Henderson',       4, 'public',       null),
  ('Bill and Lillie Heinrich YMCA',                          'Las Vegas', null,              3, 'directory',    'Directory listing'),
  ('BLVD Pickleball',                                        'Las Vegas', null,              3, 'business',     null),
  ('Centennial Hills YMCA',                                  'Las Vegas', null,              3, 'directory',    'Directory listing'),
  ('Chuck Minker Sports Complex',                            'Las Vegas', null,              3, 'directory',    'Directory listing'),
  ('Desert Breeze Community Center',                         'Las Vegas', null,              3, 'directory',    'Directory listing'),
  ('Downtown Recreation Center',                             'Las Vegas', 'Henderson',       3, 'indoor_public', null),
  ('Knight Skye Park',                                       'Las Vegas', null,              3, 'directory',    'Directory listing'),
  ('Las Vegas Motorcoach Resort',                            'Las Vegas', null,              3, 'semi_private', null),
  ('Life Time - Summerlin',                                  'Las Vegas', null,              3, 'private',      null),
  ('Mission Hills Park',                                     'Las Vegas', 'Henderson',       3, 'public',       'Combined tennis + pickleball'),
  ('Paradise Recreation & Community Services Center',        'Las Vegas', null,              3, 'directory',    'Directory listing'),
  ('Silver Springs Recreation Center',                       'Las Vegas', 'Henderson',       3, 'indoor_public', 'Verify court count before production; source includes separate 1-court listing'),
  ('Spirit Park',                                            'Las Vegas', 'North Las Vegas',  3, 'public',      null),
  ('Vegas Indoor Pickleball',                                'Las Vegas', null,              3, 'business',     null),
  ('Aventura Park',                                          'Las Vegas', 'Henderson',       2, 'public',       'Combined tennis + pickleball'),
  ('Blooming Cactus Park',                                   'Las Vegas', 'Henderson',       2, 'public',       null),
  ('Centennial Hills Park',                                  'Las Vegas', 'Las Vegas',       2, 'public',       null),
  ('Cougar Creek Park',                                      'Las Vegas', 'Clark County',    2, 'public',       null),
  ('Deer Springs Park',                                      'Las Vegas', 'North Las Vegas',  2, 'public',      null),
  ('Dundee Jones Park',                                      'Las Vegas', 'Henderson',       2, 'public',       null),
  ('Lt. Erik Lloyd Memorial Park',                           'Las Vegas', 'Clark County',    2, 'public',       'Striping shared with tennis'),
  ('Mirabelli Community Center',                             'Las Vegas', null,              2, 'directory',    'Directory listing'),
  ('Patriot Park',                                           'Las Vegas', 'Las Vegas',       2, 'public',       null),
  ('Siena Heights Trailhead',                                'Las Vegas', 'Henderson',       2, 'public',       'Combined tennis + pickleball'),
  ('Skye Hills Park',                                        'Las Vegas', null,              2, 'directory',    'Directory listing'),
  ('Skye View Park',                                         'Las Vegas', null,              2, 'directory',    'Directory listing'),
  ('Sonata Park',                                            'Las Vegas', 'Henderson',       2, 'public',       'Combined tennis + pickleball'),
  ('Sunridge Park',                                          'Las Vegas', 'Henderson',       2, 'public',       'Combined tennis + pickleball'),
  ('The Courts at The Cosmopolitan of Las Vegas',            'Las Vegas', 'Las Vegas',       2, 'private',      null),
  ('Ward 6 Pickleball Courts',                               'Las Vegas', null,              2, 'directory',    'Directory listing'),
  ('Weston Hills Park',                                      'Las Vegas', 'Henderson',       2, 'public',       'Combined tennis + pickleball'),
  ('Neighborhood Recreation Center',                         'Las Vegas', 'North Las Vegas',  1, 'public',      null),
  ('Saddlebrook Park',                                       'Las Vegas', 'North Las Vegas',  1, 'public',      null),
  ('Whitney Ranch Recreation Center',                        'Las Vegas', 'Henderson',       1, 'indoor_public', 'Indoor picklewall court');
