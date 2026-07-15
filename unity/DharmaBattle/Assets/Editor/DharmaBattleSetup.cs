#if UNITY_EDITOR
using System.IO;
using DharmaBattle.Combat;
using DharmaBattle.Core;
using DharmaBattle.Network;
using DharmaBattle.UI;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace DharmaBattle.Editor
{
    public static class DharmaBattleSetup
    {
        const string Root = "Assets/DharmaBattle";
        const string PrefabDir = Root + "/Prefabs";
        const string SceneDir = Root + "/Scenes";
        const string SpriteDir = Root + "/Sprites";

        [MenuItem("Dharma Battle/1. Setup Project (Run Once)", false, 0)]
        public static void SetupProject()
        {
            try
            {
                EnsureFolders();
                EnsurePlayerTag();
                var circle = GetOrCreateCircleSprite();
                var bulletPrefab = CreateBulletPrefab(circle);
                var enemyPrefab = CreateEnemyPrefab(circle);
                CreateBootstrapScene();
                CreateBattleScene(bulletPrefab, enemyPrefab);
                SetBuildScenes();
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
                EditorSceneManager.OpenScene(SceneDir + "/Bootstrap.unity");
                EditorUtility.DisplayDialog(
                    "Dharma Battle",
                    "Setup complete!\n\nBootstrap scene is open — press Play.\n\nSet ApiClient base URL before building to a phone.",
                    "OK");
            }
            catch (System.Exception ex)
            {
                Debug.LogException(ex);
                EditorUtility.DisplayDialog("Dharma Battle Setup Failed", ex.Message, "OK");
            }
        }

        [MenuItem("Dharma Battle/3. Fix Build Scenes", false, 2)]
        public static void FixBuildScenes()
        {
            SetBuildScenes();
            AssetDatabase.SaveAssets();
            EditorUtility.DisplayDialog(
                "Dharma Battle",
                "Bootstrap + Battle scenes added to Build Settings / Build Profile.\n\nPress Play again.",
                "OK");
        }

        [MenuItem("Dharma Battle/2. Open Bootstrap Scene", false, 1)]
        public static void OpenBootstrap()
        {
            var path = SceneDir + "/Bootstrap.unity";
            if (!File.Exists(path))
            {
                EditorUtility.DisplayDialog("Dharma Battle", "Run 'Setup Project' first.", "OK");
                return;
            }
            EditorSceneManager.OpenScene(path);
        }

        static void EnsureFolders()
        {
            if (!AssetDatabase.IsValidFolder("Assets/DharmaBattle"))
                AssetDatabase.CreateFolder("Assets", "DharmaBattle");
            if (!AssetDatabase.IsValidFolder(PrefabDir))
                AssetDatabase.CreateFolder("Assets/DharmaBattle", "Prefabs");
            if (!AssetDatabase.IsValidFolder(SceneDir))
                AssetDatabase.CreateFolder("Assets/DharmaBattle", "Scenes");
            if (!AssetDatabase.IsValidFolder(SpriteDir))
                AssetDatabase.CreateFolder("Assets/DharmaBattle", "Sprites");
        }

        static void EnsurePlayerTag()
        {
            var tagManager = new SerializedObject(
                AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset")[0]);
            var tags = tagManager.FindProperty("tags");
            for (var i = 0; i < tags.arraySize; i++)
                if (tags.GetArrayElementAtIndex(i).stringValue == "Player") return;
            tags.InsertArrayElementAtIndex(tags.arraySize);
            tags.GetArrayElementAtIndex(tags.arraySize - 1).stringValue = "Player";
            tagManager.ApplyModifiedProperties();
        }

        static Sprite GetOrCreateCircleSprite()
        {
            var path = SpriteDir + "/Circle.png";
            var existing = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            if (existing != null) return existing;

            const int size = 64;
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false);
            var center = new Vector2(size / 2f, size / 2f);
            var r = size / 2f - 2f;
            for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                var dist = Vector2.Distance(new Vector2(x, y), center);
                tex.SetPixel(x, y, dist <= r ? Color.white : Color.clear);
            }
            tex.Apply();
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path);
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer != null)
            {
                importer.textureType = TextureImporterType.Sprite;
                importer.spritePixelsPerUnit = 64;
                importer.alphaIsTransparency = true;
                importer.SaveAndReimport();
            }
            return AssetDatabase.LoadAssetAtPath<Sprite>(path);
        }

        static Bullet CreateBulletPrefab(Sprite sprite)
        {
            var path = PrefabDir + "/Bullet.prefab";
            var existing = AssetDatabase.LoadAssetAtPath<Bullet>(path);
            if (existing != null) return existing;

            var go = new GameObject("Bullet");
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = sprite;
            sr.color = new Color(1f, 0.84f, 0f);
            var col = go.AddComponent<CircleCollider2D>();
            col.isTrigger = true;
            col.radius = 0.12f;
            go.AddComponent<Bullet>();
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path).GetComponent<Bullet>();
            Object.DestroyImmediate(go);
            return prefab;
        }

        static EnemyController CreateEnemyPrefab(Sprite sprite)
        {
            var path = PrefabDir + "/Enemy.prefab";
            var existing = AssetDatabase.LoadAssetAtPath<EnemyController>(path);
            if (existing != null) return existing;

            var go = new GameObject("Enemy");
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = sprite;
            sr.color = new Color(0.55f, 0.14f, 0.67f);
            var rb = go.AddComponent<Rigidbody2D>();
            rb.bodyType = RigidbodyType2D.Kinematic;
            var col = go.AddComponent<CircleCollider2D>();
            col.isTrigger = true;
            col.radius = 0.32f;
            go.AddComponent<EnemyController>();
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path).GetComponent<EnemyController>();
            Object.DestroyImmediate(go);
            return prefab;
        }

        static void CreateBootstrapScene()
        {
            var path = SceneDir + "/Bootstrap.unity";
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var app = new GameObject("App");
            app.AddComponent<ApiClient>();
            app.AddComponent<GameSession>();
            app.AddComponent<SceneBootstrap>();
            EditorSceneManager.SaveScene(scene, path);
        }

        static void CreateBattleScene(Bullet bulletPrefab, EnemyController enemyPrefab)
        {
            var path = SceneDir + "/Battle.unity";
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            // Camera
            var cam = Camera.main;
            if (cam != null)
            {
                cam.orthographic = true;
                cam.orthographicSize = 6f;
                cam.backgroundColor = new Color(0.17f, 0.09f, 0.06f);
                cam.transform.position = new Vector3(0, 0, -10);
            }

            // Arena bounds
            var arena = new GameObject("Arena");
            var bounds = arena.AddComponent<BoxCollider2D>();
            bounds.size = new Vector2(18, 28);
            bounds.isTrigger = true;

            // Player
            var playerGo = new GameObject("Player");
            playerGo.tag = "Player";
            var psr = playerGo.AddComponent<SpriteRenderer>();
            psr.sprite = AssetDatabase.LoadAssetAtPath<Sprite>(SpriteDir + "/Circle.png");
            psr.color = new Color(0.31f, 0.76f, 0.97f);
            var prb = playerGo.AddComponent<Rigidbody2D>();
            prb.bodyType = RigidbodyType2D.Kinematic;
            var pcol = playerGo.AddComponent<CircleCollider2D>();
            pcol.radius = 0.35f;
            var player = playerGo.AddComponent<PlayerController>();
            SetSerialized(player, "bulletPrefab", bulletPrefab);

            // Battle manager
            var mgrGo = new GameObject("BattleManager");
            var mgr = mgrGo.AddComponent<BattleManager>();
            SetSerialized(mgr, "enemyPrefab", enemyPrefab);
            SetSerialized(mgr, "player", player);
            SetSerialized(mgr, "arenaBounds", bounds);

            // UI
            CreateBattleUI(player);

            EditorSceneManager.SaveScene(scene, path);
        }

        static void CreateBattleUI(PlayerController player)
        {
            if (Object.FindAnyObjectByType<EventSystem>() == null)
            {
                var es = new GameObject("EventSystem");
                es.AddComponent<EventSystem>();
                es.AddComponent<StandaloneInputModule>();
            }

            var canvasGo = new GameObject("Canvas");
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvasGo.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasGo.AddComponent<GraphicRaycaster>();

            // Joystick
            var joyBg = CreateUIRect("JoystickBG", canvasGo.transform, new Vector2(140, 140), new Vector2(160, 160), new Vector2(0, 0), new Vector2(0.08f, 0.12f));
            joyBg.GetComponent<Image>().color = new Color(0.1f, 0.1f, 0.18f, 0.6f);
            var joyHandle = CreateUIRect("JoystickHandle", joyBg.transform, new Vector2(56, 56), Vector2.zero, Vector2.zero, Vector2.one * 0.5f);
            joyHandle.GetComponent<Image>().color = new Color(1f, 0.55f, 0f, 0.85f);
            var joystick = joyBg.AddComponent<VirtualJoystick>();
            SetSerialized(joystick, "background", joyBg.GetComponent<RectTransform>());
            SetSerialized(joystick, "handle", joyHandle.GetComponent<RectTransform>());
            SetSerialized(joystick, "player", player);

            // Ability button (Image on parent, Text on child — only one Graphic per GameObject)
            var btnGo = CreateUIRect("AbilityButton", canvasGo.transform, new Vector2(100, 100), new Vector2(-140, 160), new Vector2(1, 0), new Vector2(0.92f, 0.12f));
            btnGo.GetComponent<Image>().color = new Color(0.29f, 0.05f, 0.08f);
            var btn = btnGo.AddComponent<Button>();
            CreateUILabel("Label", btnGo.transform, "SKILL", new Vector2(90, 40));
            var ability = btnGo.AddComponent<AbilityButton>();
            SetSerialized(ability, "player", player);
            SetSerialized(ability, "button", btn);
            btn.onClick.AddListener(ability.OnClick);

            var tapFire = canvasGo.AddComponent<TapFireInput>();
            SetSerialized(tapFire, "player", player);
            if (Camera.main != null)
                SetSerialized(tapFire, "cam", Camera.main);
        }

        static void CreateUILabel(string name, Transform parent, string content, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var rt = go.GetComponent<RectTransform>();
            rt.sizeDelta = size;
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
            var txt = go.AddComponent<Text>();
            txt.text = content;
            txt.alignment = TextAnchor.MiddleCenter;
            txt.color = Color.white;
            txt.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf")
                ?? Resources.GetBuiltinResource<Font>("Arial.ttf");
            txt.fontSize = 18;
        }

        static GameObject CreateUIRect(string name, Transform parent, Vector2 size, Vector2 anchoredPos, Vector2 anchorMin, Vector2 anchorMax)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            var rt = go.GetComponent<RectTransform>();
            rt.sizeDelta = size;
            rt.anchorMin = anchorMin;
            rt.anchorMax = anchorMax;
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            return go;
        }

        static void SetSerialized(Object target, string field, Object value)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(field);
            if (prop != null)
            {
                prop.objectReferenceValue = value;
                so.ApplyModifiedPropertiesWithoutUndo();
            }
        }

        static void SetBuildScenes()
        {
            var bootstrap = SceneDir + "/Bootstrap.unity";
            var battle = SceneDir + "/Battle.unity";
            var scenes = new[]
            {
                new EditorBuildSettingsScene(bootstrap, true),
                new EditorBuildSettingsScene(battle, true),
            };
            EditorBuildSettings.scenes = scenes;
            SyncActiveBuildProfile(scenes);
            Debug.Log("Build scenes registered: Bootstrap, Battle");
        }

        static void SyncActiveBuildProfile(EditorBuildSettingsScene[] scenes)
        {
            try
            {
                var profileType = System.Type.GetType("UnityEditor.Build.Profile.BuildProfile, UnityEditor");
                if (profileType == null) return;

                var getActive = profileType.GetMethod("GetActiveBuildProfile",
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public);
                var profile = getActive?.Invoke(null, null) as Object;
                if (profile == null) return;

                var overrideProp = profileType.GetProperty("overrideGlobalScenes");
                overrideProp?.SetValue(profile, true);

                var scenesProp = profileType.GetProperty("scenes");
                scenesProp?.SetValue(profile, scenes);

                EditorUtility.SetDirty(profile);
            }
            catch (System.Exception ex)
            {
                Debug.LogWarning($"Build Profile sync skipped: {ex.Message}");
            }
        }
    }
}
#endif
