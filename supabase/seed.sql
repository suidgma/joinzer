-- Seed: Las Vegas pilot location inventory
-- Source: las_vegas_pickleball_courts_master_list.csv (April 2026)
--
-- Do NOT pre-sort here. Sort at query time: ORDER BY court_count DESC, name ASC
-- Run once after migrations. To re-seed, truncate locations first.
--
-- access_type mapping:
--   Public / limited-public     → public
--   Fee-based                   → fee_based
--   Resort                      → resort
--   Private / membership        → private
--   Membership/Public programs  → indoor_public  (YMCA-type)
--   HOA / community-limited     → hoa
--   Directory listing only      → directory
--   Business/Indoor             → business
--   Indoor public               → indoor_public
--   Semi-private                → semi_private

insert into locations (name, metro_area, subarea, court_count, access_type, address, city, category, notes, source_url) values

  -- 24 courts
  ('Sunset Park Pickleball Complex', 'Las Vegas', 'Clark County', 24, 'public',
   '2601 E Sunset Rd', 'Las Vegas', 'Clark County Public',
   'Premier complex; some courts reservable',
   'https://www.clarkcountynv.gov/government/departments/parks___recreation/services/sunset-park-pickleball-complex'),

  -- 18 courts
  ('Black Mountain Recreation Center', 'Las Vegas', 'Henderson', 18, 'public',
   '599 Greenway Rd', 'Henderson', 'Henderson Public',
   'Large public facility',
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/156/783'),

  -- 16 courts
  ('The Pickleball Universe', 'Las Vegas', null, 16, 'fee_based',
   null, 'Las Vegas', 'Private/Indoor',
   'Address needs verification',
   'https://www.pickleheads.com/courts/us/nevada/las-vegas'),

  -- 15 courts
  ('Plaza Hotel & Casino', 'Las Vegas', 'Las Vegas', 15, 'resort',
   '1 Main St', 'Las Vegas', 'Resort',
   '14 permanent + 1 championship court',
   'https://www.plazahotelcasino.com/pickleball/'),

  -- 14 courts
  ('Chicken N Pickle - Henderson', 'Las Vegas', 'Henderson', 14, 'fee_based',
   '3381 St. Rose Pkwy', 'Henderson', 'Private/Indoor-Outdoor',
   '8 outdoor, 6 indoor',
   'https://chickennpickle.com/location/henderson/'),

  -- 11 courts
  ('The Picklr Henderson', 'Las Vegas', 'Henderson', 11, 'private',
   '1450 W. Horizon Ridge Pkwy, Suite 435', 'Henderson', 'Private/Indoor',
   null,
   'https://www.facebook.com/thepicklr.henderson/'),

  -- 10 courts
  ('Desert Vista Community Center', 'Las Vegas', null, 10, 'private',
   null, 'Las Vegas', 'Private/Community',
   'Exact address needs verification',
   'https://neighborhoodsinlasvegas.com/tennis-and-pickleball-courts-in-summerlin/'),

  -- 8 courts
  ('Hollywood Regional Park', 'Las Vegas', 'Clark County', 8, 'public',
   '1650 S Hollywood Blvd', 'Las Vegas', 'Clark County Public',
   null,
   'https://parkslocator.clarkcountynv.gov/Search/ParkDetail?parkId=43'),

  ('Police Memorial Park', 'Las Vegas', 'Las Vegas', 8, 'public',
   '3250 Metro Academy Way', 'Las Vegas', 'City of Las Vegas Public',
   'Dedicated outdoor courts; lights',
   'https://www.lasvegasnevada.gov/Residents/Parks-Facilities/Police-Memorial-Park'),

  ('Sun City Aliante', 'Las Vegas', 'North Las Vegas', 8, 'private',
   '7390 Aliante Pkwy', 'North Las Vegas', 'Private/Community',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Westgate Las Vegas Resort & Casino', 'Las Vegas', 'Las Vegas', 8, 'resort',
   '3000 Paradise Rd', 'Las Vegas', 'Resort',
   null,
   'https://www.bounce.game/court/westgate-resort-and-casino-las-vegas-nevada-us'),

  -- 7 courts
  ('Durango Hills Park', 'Las Vegas', 'Las Vegas', 7, 'public',
   '3521 N. Durango Dr', 'Las Vegas', 'City of Las Vegas Public',
   null,
   'https://www.lasvegasnevada.gov/Residents/Parks-Facilities/Durango-Hills-Park'),

  -- 6 courts
  ('Canyon Gate Country Club', 'Las Vegas', null, 6, 'private',
   null, 'Las Vegas', 'Private/Club',
   'Address needs verification',
   'https://www.pickleheads.com/courts/us/nevada/las-vegas/canyon-gate-country-club'),

  ('Regency at Summerlin', 'Las Vegas', null, 6, 'private',
   '6700 Regency Square Ave', 'Las Vegas', 'Private/Community',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Siena Community Association', 'Las Vegas', null, 6, 'private',
   '10525 Siena Monte Ave', 'Las Vegas', 'Private/Community',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  -- 5 courts
  ('Mr. Pickleball', 'Las Vegas', null, 5, 'fee_based',
   '2000 S Rainbow Blvd', 'Las Vegas', 'Private/Indoor',
   'Directory-listed address',
   'https://pickleballplusapp.com/us/pickleball-courts/nevada/las-vegas/mr-pickleball-indoor'),

  -- 4 courts
  ('Aloha Shores Park', 'Las Vegas', 'Las Vegas', 4, 'public',
   '7550 Sauer St', 'Las Vegas', 'City of Las Vegas Public',
   null,
   'https://www.lasvegasnevada.gov/Residents/Parks-Facilities/Aloha-Shores-Park'),

  ('Ardiente', 'Las Vegas', 'North Las Vegas', 4, 'private',
   null, 'North Las Vegas', 'Private/Community',
   'Address needs verification',
   'https://www.pickleheads.com/courts/us/nevada/north-las-vegas'),

  ('Bill Briare Family Park', 'Las Vegas', 'Las Vegas', 4, 'public',
   '650 N. Tenaya Way', 'Las Vegas', 'City of Las Vegas Public',
   null,
   'https://www.lasvegasnevada.gov/Residents/Parks-Facilities/Bill-Briare-Park'),

  ('Bob Baskin Park', 'Las Vegas', null, 4, 'public',
   '2801 W. Oakey Blvd', 'Las Vegas', 'Other/Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Justice Myron Leavitt & Jaycee Community Park', 'Las Vegas', 'Las Vegas', 4, 'public',
   '2100 E. St. Louis Ave.', 'Las Vegas', 'City of Las Vegas Public',
   null,
   'https://www.lasvegasnevada.gov/Residents/Parks-Facilities'),

  ('Lone Mountain Regional Park', 'Las Vegas', 'Clark County', 4, 'public',
   '4445 N. Jensen', 'Las Vegas', 'Clark County Public',
   null,
   'https://www.clarkcountynv.gov/government/departments/parks___recreation/facilities/pickle-ball-courts'),

  ('Lorenzi Park', 'Las Vegas', 'Las Vegas', 4, 'public',
   '3333 W. Washington Ave.', 'Las Vegas', 'City of Las Vegas Public',
   null,
   'https://www.lasvegasnevada.gov/Residents/Parks-Facilities/Lorenzi-Park'),

  ('Montagna Park', 'Las Vegas', 'Henderson', 4, 'public',
   '3495 Via Altamira', 'Henderson', 'Henderson Public',
   null,
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/421/752'),

  ('Oak Leaf Park', 'Las Vegas', 'Clark County', 4, 'hoa',
   '6303 Mesa Park Drive', 'Las Vegas', 'Clark County / Community',
   'HOA park; access may be limited',
   'https://parkslocator.clarkcountynv.gov/Search/ParkDetail?parkId=116'),

  ('Reverence Pickleball Courts', 'Las Vegas', null, 4, 'private',
   null, 'Las Vegas', 'Private/Community',
   'Conflicting addresses found; needs verification',
   'https://www.pickleheads.com/courts/us/nevada/las-vegas/reverence-pickleball-courts'),

  ('Robert E. ''Bob'' Price Recreation Center / Park', 'Las Vegas', 'Clark County', 4, 'public',
   '2050 Bonnie Lane', 'Las Vegas', 'Clark County Public',
   null,
   'https://www.clarkcountynv.gov/government/departments/parks___recreation/facilities/bobprice'),

  ('Southern Highlands Racquets', 'Las Vegas', null, 4, 'private',
   null, 'Las Vegas', 'Private/Club',
   'Address needs verification',
   'https://www.pickleheads.com/courts/us/nevada/las-vegas'),

  ('Spanish Oaks Tennis Club', 'Las Vegas', null, 4, 'private',
   '2201 Spanish Oaks Dr', 'Las Vegas', 'Private/Club',
   null,
   'https://www.pickleheads.com/courts/us/nevada/las-vegas/spanish-oaks-tennis-club'),

  ('Whitney Mesa Park', 'Las Vegas', 'Henderson', 4, 'public',
   '1550 W Galleria Drive', 'Henderson', 'Henderson Public',
   null,
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/425/33?npage=8'),

  -- 3 courts
  ('BLVD Pickleball', 'Las Vegas', null, 3, 'fee_based',
   '7165 Rafael Ridge Way', 'Las Vegas', 'Private/Indoor',
   null,
   'https://www.blvdpickleball.com/'),

  ('Bill and Lillie Heinrich YMCA', 'Las Vegas', null, 3, 'indoor_public',
   '4141 Meadows Ln', 'Las Vegas', 'YMCA',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Centennial Hills YMCA', 'Las Vegas', null, 3, 'indoor_public',
   '6601 N Buffalo Dr', 'Las Vegas', 'YMCA',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Chuck Minker Sports Complex', 'Las Vegas', null, 3, 'public',
   '275 N Mojave Rd', 'Las Vegas', 'Other/Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Desert Breeze Community Center', 'Las Vegas', null, 3, 'public',
   '8275 Spring Mountain Rd', 'Las Vegas', 'Other/Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Downtown Recreation Center', 'Las Vegas', 'Henderson', 3, 'indoor_public',
   '50 Van Wagenen St.', 'Henderson', 'Henderson Indoor',
   'Indoor courts',
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/158/783'),

  ('Knight Skye Park', 'Las Vegas', null, 3, 'public',
   '8657 N Shaumber Rd', 'Las Vegas', 'Other/Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Las Vegas Motorcoach Resort', 'Las Vegas', null, 3, 'semi_private',
   '8175 Arville St', 'Las Vegas', 'Private/Resort',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Life Time - Summerlin', 'Las Vegas', null, 3, 'private',
   null, 'Las Vegas', 'Private/Club',
   'Address needs verification',
   'https://www.pickleheads.com/courts/us/nevada/las-vegas'),

  ('Mission Hills Park', 'Las Vegas', 'Henderson', 3, 'public',
   '551 E. Mission Dr.', 'Henderson', 'Henderson Public',
   'Combined tennis + pickleball',
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/256/752'),

  ('Paradise Recreation Center', 'Las Vegas', null, 3, 'public',
   '4775 S. McLeod', 'Las Vegas', 'Other/Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Silver Springs Recreation Center', 'Las Vegas', 'Henderson', 3, 'indoor_public',
   '1951 Silver Springs Pkwy.', 'Henderson', 'Henderson Indoor',
   'Indoor courts; city page also lists a separate 1-court entry',
   'https://www.cityofhenderson.com/residents/find/recreation-centers'),

  ('Spirit Park', 'Las Vegas', 'North Las Vegas', 3, 'public',
   null, 'North Las Vegas', 'North Las Vegas Public',
   'Address needs verification',
   'https://www.pickleheads.com/courts/us/nevada/north-las-vegas'),

  ('Vegas Indoor Pickleball', 'Las Vegas', null, 3, 'fee_based',
   '7575 W Sunset Rd #110', 'Las Vegas', 'Private/Indoor',
   null,
   'https://www.vegasindoorpickleball.com/'),

  -- 2 courts
  ('Aventura Park', 'Las Vegas', 'Henderson', 2, 'public',
   '2525 Via Firenze', 'Henderson', 'Henderson Public',
   'Combined tennis + pickleball',
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/201/752'),

  ('Blooming Cactus Park', 'Las Vegas', 'Henderson', 2, 'public',
   '410 Grand Cadence Drive', 'Henderson', 'Henderson Public',
   null,
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/423/752'),

  ('Centennial Hills Park', 'Las Vegas', 'Las Vegas', 2, 'public',
   '7101 N. Buffalo Drive', 'Las Vegas', 'City of Las Vegas Public',
   null,
   'https://www.lasvegasnevada.gov/Residents/Parks-Facilities/Centennial-Hills-Park'),

  ('Cougar Creek Park', 'Las Vegas', 'Clark County', 2, 'public',
   '6635 W Cougar Ave', 'Las Vegas', 'Clark County Public',
   null,
   'https://www.clarkcountynv.gov/calendar/county-commissioners-district-f/101025-cougar-creek-5th-anniversary'),

  ('Deer Springs Park', 'Las Vegas', 'North Las Vegas', 2, 'public',
   '6550 Aviary Way', 'North Las Vegas', 'North Las Vegas Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Dundee Jones Park', 'Las Vegas', 'Henderson', 2, 'public',
   '10550 Jeffreys St', 'Henderson', 'Henderson Public',
   null,
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/370/752'),

  ('Lt. Erik Lloyd Memorial Park', 'Las Vegas', 'Clark County', 2, 'public',
   null, 'Las Vegas', 'Clark County Public',
   'Address needs verification',
   'https://www.pickleheads.com/courts/us/nevada/las-vegas/lt-erik-lloyd-memorial-park'),

  ('Mirabelli Community Center', 'Las Vegas', null, 2, 'public',
   '6200 Hargrove Ave', 'Las Vegas', 'Other/Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Patriot Community Park', 'Las Vegas', 'Las Vegas', 2, 'public',
   '4050 Thom Blvd.', 'Las Vegas', 'City of Las Vegas Public',
   null,
   'https://www.lasvegasnevada.gov/Residents/Parks-Facilities/Patriot-Park'),

  ('Siena Heights Trailhead', 'Las Vegas', 'Henderson', 2, 'public',
   '2570 Siena Heights Dr.', 'Henderson', 'Henderson Public',
   'Combined tennis + pickleball',
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Skye Hills Park', 'Las Vegas', null, 2, 'public',
   '7599 Sky Pointe Dr', 'Las Vegas', 'Other/Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Skye View Park', 'Las Vegas', null, 2, 'public',
   '10501 Eagle Canyon Ave', 'Las Vegas', 'Other/Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Sonata Park', 'Las Vegas', 'Henderson', 2, 'public',
   '1550 Seven Hills Dr.', 'Henderson', 'Henderson Public',
   'Combined tennis + pickleball',
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/306/752'),

  ('Sunridge Park', 'Las Vegas', 'Henderson', 2, 'public',
   '1010 Sandy Ridge Ave.', 'Henderson', 'Henderson Public',
   'Combined tennis + pickleball',
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/310/752'),

  ('Ward 6 Pickleball Courts', 'Las Vegas', null, 2, 'public',
   null, 'Las Vegas', 'Other/Public',
   'Address needs verification',
   'https://www.pickleheads.com/courts/us/nevada/las-vegas'),

  ('Weston Hills Park', 'Las Vegas', 'Henderson', 2, 'public',
   '950 Weston Ridge St.', 'Henderson', 'Henderson Public',
   'Combined tennis + pickleball',
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/322/752'),

  -- 1 court
  ('Neighborhood Recreation Center', 'Las Vegas', 'North Las Vegas', 1, 'public',
   '1638 N Bruce St', 'North Las Vegas', 'North Las Vegas Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Saddlebrook Park', 'Las Vegas', 'North Las Vegas', 1, 'public',
   '1146 W Dorrell Lane', 'North Las Vegas', 'North Las Vegas Public',
   null,
   'https://www.southernnevadapickleball.org/venues.php'),

  ('Whitney Ranch Recreation Center', 'Las Vegas', 'Henderson', 1, 'indoor_public',
   '1575 Galleria Dr.', 'Henderson', 'Henderson Indoor',
   'Indoor picklewall court',
   'https://www.cityofhenderson.com/Home/Components/FacilityDirectory/FacilityDirectory/170/783');
