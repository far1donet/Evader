import * as T from 'three';

export type GearView = 'rider' | 'headwear' | 'deck' | 'base';

const viewAngles: Record<GearView, number> = { rider: -2.02, headwear: -.38, deck: .16, base: -.22 };
const up = new T.Vector3(0, 1, 0);

export class GearPreview {
    readonly scene = new T.Scene();
    readonly camera = new T.PerspectiveCamera(34, 1, .05, 40);
    view: GearView = 'rider';
    private angle = viewAngles.rider;
    private displayedAngle = this.angle;
    private readonly board: T.Group;
    private readonly boardCenter: T.Vector3;
    private readonly boardCorners: T.Vector3[];
    private readonly viewDirection = new T.Vector3();
    private readonly viewRight = new T.Vector3();
    private readonly viewUp = new T.Vector3();
    private readonly rotatedCorner = new T.Vector3();
    private readonly rider: T.Group;
    private readonly floor: T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial>;
    private readonly key: T.DirectionalLight;

    constructor(rider: T.Group, board: T.Group, environment: T.Texture) {
        this.rider = rider;
        this.board = board.clone();
        const bounds = new T.Box3().setFromObject(this.board);
        this.boardCenter = bounds.getCenter(new T.Vector3());
        this.boardCorners = [bounds.min.x, bounds.max.x].flatMap(x =>
            [bounds.min.y, bounds.max.y].flatMap(y =>
                [bounds.min.z, bounds.max.z].map(z => new T.Vector3(x, y, z)),
            ),
        );
        this.scene.background = new T.Color(0xa2b2c3);
        this.scene.environment = environment;
        this.scene.environmentIntensity = .39;
        this.scene.add(this.board, new T.HemisphereLight(0xe8efff, 0x9faab9, 1.15));

        this.key = new T.DirectionalLight(0xfff4e7, 2.15);
        this.key.position.set(-4, 5, 3);
        this.key.castShadow = true;
        this.key.shadow.mapSize.set(1024, 1024);
        this.key.shadow.camera.left = this.key.shadow.camera.bottom = -2.6;
        this.key.shadow.camera.right = this.key.shadow.camera.top = 2.6;
        this.key.shadow.normalBias = .012;
        const rim = new T.DirectionalLight(0xd8e8ff, 1.05);
        rim.position.set(4, 2, -3);
        const under = new T.DirectionalLight(0xe5efff, 1.5);
        under.position.set(1, -3, 1);
        this.scene.add(this.key, rim, under);

        this.floor = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshStandardMaterial({ color: 0xa2b2c3, roughness: .95 }));
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.y = -.013;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
        this.update(0);
    }

    setView(view: GearView) {
        this.view = view;
        this.angle = viewAngles[view];
        this.displayedAngle = this.angle;
    }

    rotate(radians: number) {
        this.angle += radians;
    }

    get showsRider() { return this.view === 'rider' || this.view === 'headwear'; }

    update(dt: number) {
        this.displayedAngle = T.MathUtils.damp(this.displayedAngle, this.angle, 18, dt);
        this.rider.visible = this.floor.visible = this.showsRider;
        this.board.visible = !this.showsRider;
        if (this.showsRider) {
            const close = this.view === 'headwear';
            const radius = (close ? 1.42 : 3.92) * Math.max(1, .75 / this.camera.aspect);
            this.camera.position.set(Math.sin(this.displayedAngle) * radius, close ? 1.62 : 1.94, -Math.cos(this.displayedAngle) * radius);
            this.camera.lookAt(0, close ? 1.49 : .87, 0);
        } else {
            this.board.rotation.y = this.displayedAngle;
            const y = this.view === 'deck' ? 2.02 : -1.94;
            this.viewDirection.set(.14, y, 1.13).normalize();
            this.viewRight.crossVectors(up, this.viewDirection).normalize();
            this.viewUp.crossVectors(this.viewDirection, this.viewRight);
            const halfView = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)) * .88;
            let distance = 0;
            // Fit the rotated board and bindings, including the depth of the nearest tip.
            for (const corner of this.boardCorners) {
                const offset = this.rotatedCorner.copy(corner).applyAxisAngle(up, this.displayedAngle).sub(this.boardCenter);
                const horizontal = Math.abs(offset.dot(this.viewRight)) / (halfView * this.camera.aspect);
                const vertical = Math.abs(offset.dot(this.viewUp)) / halfView;
                distance = Math.max(distance, offset.dot(this.viewDirection) + Math.max(horizontal, vertical));
            }
            this.camera.position.copy(this.boardCenter).addScaledVector(this.viewDirection, distance);
            this.camera.lookAt(this.boardCenter);
        }
    }

    dispose() {
        this.key.shadow.dispose();
        this.floor.geometry.dispose();
        this.floor.material.dispose();
    }
}
